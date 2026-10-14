import type { BrokerSession } from '@tickdeck/broker';
import {
  DisposableGroup,
  Emitter,
  ObservableValue,
  microtask,
  type Listener,
  type ReadonlyObservableValue,
  type Unsubscribe,
} from '@tickdeck/core';
import { chartViewInternals, type ChartView } from '../chart-view';
import type { EngineChart, EngineOverlayEvent } from '../engine';
import { formatMoney, snapOrderPrice } from '../price';
import {
  lineTargetIds,
  planLineMove,
  planLineRemoval,
  runTradingAction,
  TradingEdits,
  type TradingAction,
} from './actions';
import {
  FILL_OVERLAY,
  LINE_OVERLAY,
  REMOVE_KEY,
  ensureTradingOverlays,
  type FillRender,
  type LineRender,
  type RenderSource,
} from './figures';
import {
  ALL_VISIBLE,
  buildTradingScene,
  formatPositionPnl,
  type PnlUnit,
  type TradingLine,
  type TradingLineEdit,
  type TradingScene,
  type TradingVisibility,
} from './scene';

export interface TradingOverlayOptions {
  /** Show working orders and their exits. Default true. */
  orders?: boolean;
  /** Show positions and their exits. Default true. */
  positions?: boolean;
  /** Show fill markers. Default true. */
  fills?: boolean;
  /** What a position's P&L label shows. Default `['money']`. */
  pnl?: readonly PnlUnit[];
  /** Most recent fills marked. Default 50. */
  maxFills?: number;
  /** Formats P&L amounts. Default: sign, two decimals and the currency code. */
  formatMoney?: (value: number, currency?: string) => string;
}

export interface TradingActionEvent {
  lineId: string;
  action: TradingAction;
}

export interface TradingActionErrorEvent extends TradingActionEvent {
  /** The broker's rejection, or an `AckTimeoutError` when no confirmation arrived in time. */
  error: unknown;
}

export interface TradingOverlayEvents {
  /** A broker call was sent from the chart (drag, cancel or close). */
  action: TradingActionEvent;
  /** A call sent from the chart failed or was not confirmed in time. The line shows the broker's state again. */
  actionError: TradingActionErrorEvent;
}

/** Orders, exits, positions and fills of a `BrokerSession`, drawn on a chart. Create one with {@link attachTrading}. */
export interface TradingOverlay {
  readonly view: ChartView;
  readonly session: BrokerSession;
  readonly visibility: ReadonlyObservableValue<TradingVisibility>;
  /** What is drawn right now. */
  readonly scene: ReadonlyObservableValue<TradingScene>;
  readonly disposed: boolean;
  on<K extends keyof TradingOverlayEvents>(event: K, listener: Listener<TradingOverlayEvents[K]>): Unsubscribe;
  setVisibility(changes: Partial<TradingVisibility>): void;
  /**
   * Moves a line to `price` (rounded to the tick), as dragging it does. The
   * line keeps the new price until the broker confirms; on failure it goes
   * back, `actionError` is emitted and the promise rejects.
   */
  moveLine(lineId: string, price: number): Promise<void>;
  /** Cancels the order or exit, or closes the position, as the line's button does. */
  removeLine(lineId: string): Promise<void>;
  /** Removes everything drawn and stops listening. Disposing the chart view disposes its overlays. */
  dispose(): void;
}

interface DragState {
  lineId: string;
  startPrice: number;
  /** False when the line cannot move; the engine's move is then undone on every step. */
  active: boolean;
}

const Z_LEVEL = { fill: 1, position: 2, exit: 3, order: 4 } as const;

let overlayCount = 0;

class TradingOverlayImpl implements TradingOverlay {
  readonly view: ChartView;
  readonly session: BrokerSession;
  readonly visibility: ReadonlyObservableValue<TradingVisibility>;
  readonly scene: ReadonlyObservableValue<TradingScene>;

  readonly #engine: EngineChart;
  readonly #group = `tdk-trading-${++overlayCount}`;
  readonly #events = new Emitter<TradingOverlayEvents>();
  readonly #visibility: ObservableValue<TradingVisibility>;
  readonly #scene = new ObservableValue<TradingScene>({ lines: [], fills: [] });
  readonly #edits = new TradingEdits();
  readonly #actions = new Map<string, TradingAction>();
  readonly #lines = new Map<string, LineRender>();
  readonly #lineSignatures = new Map<string, string>();
  readonly #fills = new Map<string, FillRender>();
  readonly #fillSignatures = new Map<string, string>();
  readonly #subscriptions = new DisposableGroup();
  readonly #pnlUnits: readonly PnlUnit[];
  readonly #maxFills: number | undefined;
  readonly #formatMoney: (value: number, currency?: string) => string;
  #drag: DragState | undefined;
  #renderQueued = false;
  #disposed = false;

  constructor(view: ChartView, session: BrokerSession, options: TradingOverlayOptions) {
    const internals = chartViewInternals(view);
    ensureTradingOverlays();
    this.view = view;
    this.session = session;
    this.#engine = internals.engine;
    this.#pnlUnits = options.pnl ?? ['money'];
    this.#maxFills = options.maxFills;
    this.#formatMoney = options.formatMoney ?? formatMoney;
    this.#visibility = new ObservableValue<TradingVisibility>(
      { orders: options.orders ?? true, positions: options.positions ?? true, fills: options.fills ?? true },
      { equals: (a, b) => a.orders === b.orders && a.positions === b.positions && a.fills === b.fills },
    );
    this.visibility = this.#visibility.asReadonly();
    this.scene = this.#scene.asReadonly();

    const touched = (ids: Array<string | undefined>) => {
      this.#edits.touch(ids.filter((id): id is string => id !== undefined));
      this.#scheduleRender();
    };
    const group = this.#subscriptions;
    group.add(session.on('order', (order) => touched([order.id, order.parent?.id])));
    group.add(session.on('position', (position) => touched([position.id])));
    group.add(session.on('fill', (fill) => touched([fill.orderId, fill.positionId])));
    group.add(session.on('pnl', () => this.#scheduleRender()));
    group.add(
      session.on('resync', () => {
        this.#edits.touch();
        this.#scheduleRender();
      }),
    );
    group.add(session.on('timeout', (error) => this.#onTimeout(error.targetId, error)));
    group.add(view.instrumentInfo.subscribe(() => this.#scheduleRender()));
    group.add(view.colors.subscribe(() => this.#redrawAll()));
    group.add(
      view.on('bars', (change) => {
        // Every change can move fill markers onto other bars; realtime updates matter only for positions marked from bars.
        if (change.kind !== 'update' || this.#marksFromBars()) this.#scheduleRender();
      }),
    );
    group.add(this.#visibility.subscribe(() => this.#render()));
    group.add(internals.onDispose(() => this.dispose()));
    this.#render();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  on<K extends keyof TradingOverlayEvents>(event: K, listener: Listener<TradingOverlayEvents[K]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  setVisibility(changes: Partial<TradingVisibility>): void {
    this.#assertLive();
    this.#visibility.set({ ...this.#visibility.value, ...changes });
  }

  async moveLine(lineId: string, price: number): Promise<void> {
    this.#assertLive();
    const line = this.#requireLine(lineId);
    const instrument = this.view.instrumentInfo.value;
    if (!instrument) throw new Error('The chart has no instrument yet');
    const target = snapOrderPrice(price, instrument.tickSize);
    const action = planLineMove(line, target, this.session.capabilities);
    if (!action) throw new Error(`Line ${lineId} cannot be moved`);
    if (target === line.price && !line.pending) return;
    await this.#perform(line, action, { price: target });
  }

  async removeLine(lineId: string): Promise<void> {
    this.#assertLive();
    const line = this.#requireLine(lineId);
    const action = planLineRemoval(line, this.session.capabilities);
    if (!action) throw new Error(`Line ${lineId} cannot be removed`);
    await this.#perform(line, action, { removing: true });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#subscriptions.dispose();
    if (!this.view.disposed) this.#engine.removeOverlay({ groupId: this.#group });
    this.#lines.clear();
    this.#fills.clear();
    this.#lineSignatures.clear();
    this.#fillSignatures.clear();
    this.#edits.clear();
    this.#events.removeAllListeners();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('The trading overlay is disposed');
  }

  #requireLine(lineId: string): TradingLine {
    const line = this.#scene.value.lines.find((candidate) => candidate.id === lineId);
    if (!line) throw new Error(`No line ${lineId} on the chart`);
    return line;
  }

  async #perform(line: TradingLine, action: TradingAction, edit: TradingLineEdit): Promise<void> {
    this.#edits.begin(line.id, edit, lineTargetIds(line.target));
    this.#actions.set(line.id, action);
    this.#render();
    this.#events.emit('action', { lineId: line.id, action });
    try {
      await runTradingAction(this.session, action);
      this.#edits.settle(line.id);
    } catch (error) {
      if (this.#edits.has(line.id)) {
        this.#edits.fail(line.id);
        this.#events.emit('actionError', { lineId: line.id, action, error });
      }
      throw error;
    } finally {
      this.#scheduleRender();
    }
  }

  #onTimeout(targetId: string | undefined, error: unknown): void {
    if (targetId === undefined) return;
    for (const lineId of this.#edits.expire(targetId)) {
      const action = this.#actions.get(lineId);
      if (action) this.#events.emit('actionError', { lineId, action, error });
    }
    this.#scheduleRender();
  }

  #marksFromBars(): boolean {
    const id = this.view.instrumentInfo.value?.id;
    return this.session.positions.some(
      (position) => position.instrument === id && (position.unrealizedPnl === undefined || position.lastPrice === undefined),
    );
  }

  #scheduleRender(): void {
    if (this.#renderQueued || this.#disposed) return;
    this.#renderQueued = true;
    microtask(() => {
      this.#renderQueued = false;
      this.#render();
    });
  }

  #render(): void {
    if (this.#disposed || this.view.disposed) return;
    const instrument = this.view.instrumentInfo.value;
    let scene: TradingScene = { lines: [], fills: [] };
    if (instrument) {
      const input = {
        instrument,
        orders: this.session.orders,
        positions: this.session.positions,
        fills: this.session.fills,
        capabilities: this.session.capabilities,
        bars: this.view.bars,
        maxFills: this.#maxFills,
      };
      this.#edits.reconcile(buildTradingScene({ ...input, visibility: ALL_VISIBLE }).lines);
      for (const lineId of this.#actions.keys()) if (!this.#edits.has(lineId)) this.#actions.delete(lineId);
      scene = buildTradingScene({ ...input, visibility: this.#visibility.value, edits: this.#edits.view });
    }
    this.#scene.set(scene);
    this.#syncLines(scene.lines);
    this.#syncFills(scene);
  }

  #redrawAll(): void {
    this.#lineSignatures.forEach((_, id) => this.#lineSignatures.set(id, ''));
    this.#fillSignatures.forEach((_, id) => this.#fillSignatures.set(id, ''));
    this.#render();
  }

  #syncLines(lines: readonly TradingLine[]): void {
    const colors = this.view.colors.value;
    const formatPrice = (price: number) => this.view.formatPrice(price);
    const seen = new Set<string>();
    for (const line of lines) {
      seen.add(line.id);
      const pnlText = line.pnl ? formatPositionPnl(line.pnl, this.#pnlUnits, this.#formatMoney) : undefined;
      this.#lines.set(line.id, { line, colors, formatPrice, pnlText });
      const signature = JSON.stringify([line, pnlText]);
      const previous = this.#lineSignatures.get(line.id);
      this.#lineSignatures.set(line.id, signature);
      const id = this.#overlayId(line.id);
      const lock = !line.draggable || line.pending;
      if (previous === undefined) {
        const source: RenderSource<LineRender> = { render: () => this.#lines.get(line.id) };
        this.#engine.createOverlay({
          name: LINE_OVERLAY,
          id,
          groupId: this.#group,
          points: [{ value: line.price }],
          lock,
          zLevel: line.kind === 'position' ? Z_LEVEL.position : line.kind === 'order' ? Z_LEVEL.order : Z_LEVEL.exit,
          fixedZLevel: true,
          extendData: source,
          onPressedMoveStart: (event) => this.#onDragStart(line.id, event),
          onPressedMoving: (event) => this.#onDragMove(line.id, event),
          onPressedMoveEnd: (event) => this.#onDragEnd(line.id, event),
          onClick: (event) => this.#onClick(line.id, event),
          onRightClick: (event) => event.preventDefault?.(),
        });
      } else if (previous !== signature) {
        // A line being dragged keeps the pointer's price until it is dropped.
        const dragging = this.#drag?.lineId === line.id;
        this.#engine.overrideOverlay(dragging ? { id, lock } : { id, lock, points: [{ value: line.price }] });
      }
    }
    for (const lineId of [...this.#lineSignatures.keys()]) {
      if (seen.has(lineId)) continue;
      this.#engine.removeOverlay({ id: this.#overlayId(lineId) });
      this.#lineSignatures.delete(lineId);
      this.#lines.delete(lineId);
      if (this.#drag?.lineId === lineId) this.#drag = undefined;
    }
  }

  #syncFills(scene: TradingScene): void {
    const colors = this.view.colors.value;
    const seen = new Set<string>();
    for (const marker of scene.fills) {
      seen.add(marker.id);
      this.#fills.set(marker.id, { marker, colors });
      const signature = JSON.stringify(marker);
      const previous = this.#fillSignatures.get(marker.id);
      this.#fillSignatures.set(marker.id, signature);
      const id = this.#overlayId(marker.id);
      const points = [{ timestamp: marker.time, value: marker.price }];
      if (previous === undefined) {
        const source: RenderSource<FillRender> = { render: () => this.#fills.get(marker.id) };
        this.#engine.createOverlay({
          name: FILL_OVERLAY,
          id,
          groupId: this.#group,
          points,
          lock: true,
          zLevel: Z_LEVEL.fill,
          fixedZLevel: true,
          extendData: source,
          onRightClick: (event) => event.preventDefault?.(),
        });
      } else if (previous !== signature) {
        this.#engine.overrideOverlay({ id, points });
      }
    }
    for (const markerId of [...this.#fillSignatures.keys()]) {
      if (seen.has(markerId)) continue;
      this.#engine.removeOverlay({ id: this.#overlayId(markerId) });
      this.#fillSignatures.delete(markerId);
      this.#fills.delete(markerId);
    }
  }

  #overlayId(key: string): string {
    return `${this.#group}:${key}`;
  }

  #onDragStart(lineId: string, event: EngineOverlayEvent): void {
    const line = this.#lines.get(lineId)?.line;
    if (!line) return;
    this.#drag = {
      lineId,
      startPrice: line.price,
      active: line.draggable && !line.pending && event.figure?.key !== REMOVE_KEY,
    };
  }

  #onDragMove(lineId: string, event: EngineOverlayEvent): void {
    const drag = this.#drag;
    const point = event.overlay.points[0];
    if (!drag || drag.lineId !== lineId || !point) return;
    const tickSize = this.view.instrumentInfo.value?.tickSize;
    const value = point.value;
    point.value =
      drag.active && tickSize !== undefined && value !== undefined && Number.isFinite(value)
        ? snapOrderPrice(value, tickSize)
        : drag.startPrice;
  }

  #onDragEnd(lineId: string, event: EngineOverlayEvent): void {
    const drag = this.#drag;
    if (!drag || drag.lineId !== lineId) return;
    this.#drag = undefined;
    // Forces the next render to put the line where the model says.
    if (this.#lineSignatures.has(lineId)) this.#lineSignatures.set(lineId, '');
    const price = event.overlay.points[0]?.value;
    if (drag.active && price !== undefined && price !== drag.startPrice) {
      this.moveLine(lineId, price).catch(() => {});
    } else {
      this.#render();
    }
  }

  #onClick(lineId: string, event: EngineOverlayEvent): void {
    if (event.figure?.key !== REMOVE_KEY) return;
    const line = this.#lines.get(lineId)?.line;
    if (!line || line.pending) return;
    this.removeLine(lineId).catch(() => {});
  }
}

/**
 * Draws a broker session's working orders, protective exits, positions and
 * fills for the chart's instrument, and turns chart gestures into broker
 * calls: dragging a line amends its price, the × button cancels an order
 * or exit, or closes a position. The overlay follows the session's updates
 * and the chart's instrument.
 */
export function attachTrading(view: ChartView, session: BrokerSession, options: TradingOverlayOptions = {}): TradingOverlay {
  return new TradingOverlayImpl(view, session, options);
}
