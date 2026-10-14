import type { AckTimeoutError, BrokerConnection, BrokerNotice, BrokerOrder, Fill, OrderUpdateProblem } from '@tickdeck/broker';
import type { TimerHandle } from '@tickdeck/core';
import { describeOrder } from './account-panel';
import { describeTradingError } from './actions';
import type { WidgetContext } from './context';
import { WidgetController } from './controller';
import { InstrumentFormat, getInstrumentResolver, type InstrumentResolver, type TradableInstrument } from './instrument';
import { EXIT_ROLE_LABELS } from './labels';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';
/** Where a notification came from. `app` is anything pushed with `NotificationCenter#push`. */
export type NotificationSource = 'notice' | 'fill' | 'rejection' | 'timeout' | 'violation' | 'connection' | 'app';

export interface NotificationItem {
  id: string;
  level: NotificationLevel;
  title: string;
  message?: string;
  source: NotificationSource;
  /** UTC epoch milliseconds. */
  time: number;
  orderId?: string;
  positionId?: string;
}

export interface NotificationInput {
  level: NotificationLevel;
  title: string;
  message?: string;
  source?: NotificationSource;
  orderId?: string;
  positionId?: string;
  /** How long the toast stays, overriding the level's default. 0 keeps it until dismissed. */
  durationMs?: number;
}

export interface NotificationCenterState {
  /** Toasts on screen, oldest first. */
  toasts: readonly NotificationItem[];
  /** Every notification of this session, newest first, up to `logLimit`. */
  log: readonly NotificationItem[];
  /** Auto-dismiss is paused (the user is hovering or focusing the toasts). */
  paused: boolean;
}

export interface NotificationCenterEvents {
  notification: NotificationItem;
  dismiss: NotificationItem;
}

export interface NotificationCenterOptions {
  /** Milliseconds each level stays on screen; 0 keeps it until dismissed. Defaults: info and success 5000, warning 8000, error 10000. */
  durations?: Partial<Record<NotificationLevel, number>>;
  /** Most toasts on screen at once; older ones leave first. Default 4. */
  maxToasts?: number;
  /** Most entries kept in the log. Default 100. */
  logLimit?: number;
  /** Turn sources off, e.g. `{ fill: false }`. All are on by default. */
  sources?: Partial<Record<Exclude<NotificationSource, 'app'>, boolean>>;
}

const DEFAULT_DURATIONS: Record<NotificationLevel, number> = { info: 5_000, success: 5_000, warning: 8_000, error: 10_000 };

interface Timer {
  remaining: number;
  startedAt: number;
  handle: TimerHandle | undefined;
}

/**
 * Turns session activity into toasts and a log: broker notices, fills,
 * rejections, acknowledgement timeouts, ignored updates and connection
 * changes. Toasts dismiss themselves after a while; pausing holds them while
 * the user reads.
 */
export class NotificationCenter extends WidgetController<NotificationCenterState, NotificationCenterEvents> {
  readonly #resolver: InstrumentResolver;
  readonly #durations: Record<NotificationLevel, number>;
  readonly #maxToasts: number;
  readonly #logLimit: number;
  readonly #timers = new Map<string, Timer>();
  readonly #rejected = new Set<string>();
  #sequence = 0;
  #connection: BrokerConnection['state'];
  #wasConnected: boolean;

  constructor(context: WidgetContext, options: NotificationCenterOptions = {}) {
    super(context, { toasts: [], log: [], paused: false });
    this.#resolver = getInstrumentResolver(context);
    this.#durations = { ...DEFAULT_DURATIONS, ...options.durations };
    this.#maxToasts = Math.max(1, options.maxToasts ?? 4);
    this.#logLimit = Math.max(1, options.logLimit ?? 100);
    const session = context.session;
    this.#connection = session.connection.value.state;
    this.#wasConnected = this.#connection === 'connected';
    const enabled = (source: Exclude<NotificationSource, 'app'>) => options.sources?.[source] !== false;
    if (enabled('notice')) this.disposables.add(session.on('notice', (notice) => this.#onNotice(notice)));
    if (enabled('fill')) this.disposables.add(session.on('fill', (fill) => this.#onFill(fill)));
    if (enabled('rejection')) this.disposables.add(session.on('order', (order) => this.#onOrder(order)));
    if (enabled('timeout')) this.disposables.add(session.on('timeout', (error) => this.#onTimeout(error)));
    if (enabled('violation')) this.disposables.add(session.on('violation', (problem) => this.#onViolation(problem)));
    const watchConnection = enabled('connection');
    this.disposables.add(session.connection.subscribe((connection) => this.#onConnection(connection, watchConnection)));
    this.disposables.add(() => {
      for (const timer of this.#timers.values()) this.#stop(timer);
      this.#timers.clear();
    });
  }

  /** Shows a notification and adds it to the log. */
  push(input: NotificationInput): NotificationItem {
    const item: NotificationItem = {
      id: `n${++this.#sequence}`,
      level: input.level,
      title: input.title,
      message: input.message,
      source: input.source ?? 'app',
      time: this.scheduler.now(),
      orderId: input.orderId,
      positionId: input.positionId,
    };
    if (this.disposed) return item;
    const { toasts, log, paused } = this.state.value;
    const shown = [...toasts, item];
    const dropped = shown.splice(0, Math.max(0, shown.length - this.#maxToasts));
    for (const old of dropped) this.#clearTimer(old.id);
    const duration = input.durationMs ?? this.#durations[item.level];
    if (duration > 0) {
      const timer: Timer = { remaining: duration, startedAt: this.scheduler.now(), handle: undefined };
      this.#timers.set(item.id, timer);
      if (!paused) this.#start(item.id, timer);
    }
    this.setState({ toasts: shown, log: [item, ...log].slice(0, this.#logLimit) });
    this.emit('notification', item);
    for (const old of dropped) this.emit('dismiss', old);
    return item;
  }

  /** Removes a toast. It stays in the log. */
  dismiss(id: string): void {
    const item = this.state.value.toasts.find((toast) => toast.id === id);
    if (!item) return;
    this.#clearTimer(id);
    this.setState({ toasts: this.state.value.toasts.filter((toast) => toast.id !== id) });
    this.emit('dismiss', item);
  }

  dismissAll(): void {
    for (const toast of [...this.state.value.toasts]) this.dismiss(toast.id);
  }

  clearLog(): void {
    this.setState({ log: [] });
  }

  /** Holds auto-dismiss, for example while the pointer is over the toasts. */
  pause(): void {
    if (this.state.value.paused) return;
    const now = this.scheduler.now();
    for (const timer of this.#timers.values()) {
      this.#stop(timer);
      timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
    }
    this.setState({ paused: true });
  }

  resume(): void {
    if (!this.state.value.paused) return;
    this.setState({ paused: false });
    for (const [id, timer] of this.#timers) this.#start(id, timer);
  }

  #start(id: string, timer: Timer): void {
    timer.startedAt = this.scheduler.now();
    timer.handle = this.scheduler.setTimeout(() => {
      timer.handle = undefined;
      this.dismiss(id);
    }, timer.remaining);
  }

  #stop(timer: Timer): void {
    if (timer.handle !== undefined) this.scheduler.clearTimeout(timer.handle);
    timer.handle = undefined;
  }

  #clearTimer(id: string): void {
    const timer = this.#timers.get(id);
    if (!timer) return;
    this.#stop(timer);
    this.#timers.delete(id);
  }

  /** Runs `show` with the instrument's formatting, right away when it is known. */
  #withFormat(instrument: string, show: (format: InstrumentFormat) => void): void {
    const known = this.#resolver.peek(instrument);
    if (known) {
      show(new InstrumentFormat(known));
      return;
    }
    this.#resolver.get(instrument).then(
      (resolved: TradableInstrument) => show(new InstrumentFormat(resolved)),
      () => show(new InstrumentFormat(undefined)),
    );
  }

  #onNotice(notice: BrokerNotice): void {
    if (notice.orderId && notice.level === 'error' && this.#rejected.has(notice.orderId)) return;
    this.push({
      level: notice.level,
      title: notice.title,
      message: notice.message,
      source: 'notice',
      orderId: notice.orderId,
      positionId: notice.positionId,
    });
  }

  #onFill(fill: Fill): void {
    const order = fill.orderId ? this.session.getOrder(fill.orderId) : undefined;
    this.#withFormat(fill.instrument, (format) => {
      const name = format.name || fill.instrument;
      const verb = fill.side === 'buy' ? 'Bought' : 'Sold';
      let message = `${verb} ${format.quantity(fill.quantity)} ${name} at ${format.price(fill.price)}`;
      if (fill.realizedPnl) {
        const currency = format.instrument?.currency;
        message += `, P&L ${format.money(fill.realizedPnl, true)}${currency ? ` ${currency}` : ''}`;
      }
      this.push({
        level: 'success',
        title: order?.exitRole ? `${EXIT_ROLE_LABELS[order.exitRole]} filled` : 'Order filled',
        message,
        source: 'fill',
        orderId: fill.orderId,
        positionId: fill.positionId,
      });
    });
  }

  #onOrder(order: BrokerOrder): void {
    if (order.state !== 'rejected' || this.#rejected.has(order.id)) return;
    this.#rejected.add(order.id);
    this.#withFormat(order.instrument, (format) => {
      const description = describeOrder(order, format);
      this.push({
        level: 'error',
        title: 'Order rejected',
        message: order.message ? `${description}: ${order.message}` : description,
        source: 'rejection',
        orderId: order.id,
      });
    });
  }

  #onTimeout(error: AckTimeoutError): void {
    this.push({
      level: 'error',
      title: 'No confirmation from the broker',
      message: describeTradingError(error),
      source: 'timeout',
      orderId: error.action === 'submit' || error.action === 'amend' || error.action === 'cancel' ? error.targetId : undefined,
      positionId: error.action === 'close' || error.action === 'reverse' || error.action === 'set-exits' ? error.targetId : undefined,
    });
  }

  #onViolation(problem: OrderUpdateProblem): void {
    this.push({
      level: 'warning',
      title: 'Ignored an inconsistent order update',
      message: problem.message,
      source: 'violation',
      orderId: problem.orderId,
    });
  }

  #onConnection(connection: BrokerConnection, notify: boolean): void {
    const previous = this.#connection;
    this.#connection = connection.state;
    if (previous === connection.state) return;
    if (connection.state === 'connected') {
      if (notify && this.#wasConnected) this.push({ level: 'success', title: 'Reconnected', source: 'connection' });
      this.#wasConnected = true;
    } else if (previous === 'connected' && (connection.state === 'disconnected' || connection.state === 'error') && notify) {
      this.push({
        level: connection.state === 'error' ? 'error' : 'warning',
        title: 'Connection to the broker lost',
        message: connection.message,
        source: 'connection',
      });
    }
  }
}
