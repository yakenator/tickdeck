import {
  Emitter,
  ObservableValue,
  oppositeSide,
  type Listener,
  type ReadonlyObservableValue,
  type Scheduler,
  type Unsubscribe,
} from '@tickdeck/core';
import {
  resolveBrokerCapabilities,
  type BrokerConnector,
  type BrokerUpdate,
  type BrokerUpdates,
  type BrokerUpdateSink,
} from './contract';
import { checkOrderUpdate, isFinalState, type OrderUpdateProblem } from './order-state';
import type {
  AccountBalance,
  BrokerAccount,
  BrokerConnection,
  BrokerOrder,
  BrokerPosition,
  Fill,
  OrderAmendment,
  OrderCheck,
  OrderRequest,
  ProtectiveExits,
  ResolvedBrokerCapabilities,
  ResyncSnapshot,
  TradingRules,
} from './types';
import { AckWatchdog, type AckExpectation, type AckTimeoutError, type PendingAck } from './watchdog';

export type BrokerErrorCode = 'unsupported' | 'not-found' | 'not-started';

export class BrokerError extends Error {
  override readonly name = 'BrokerError';
  readonly code: BrokerErrorCode;

  constructor(code: BrokerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface BrokerSessionEvents extends BrokerUpdates {
  /** An action was not confirmed in time. A resync follows unless disabled. */
  timeout: AckTimeoutError;
  /** The connector pushed an update that breaks the order lifecycle. The update was ignored. */
  violation: OrderUpdateProblem;
}

export interface BrokerSessionOptions {
  /** Acknowledgement deadline for actions. Default 10000. */
  ackTimeoutMs?: number;
  scheduler?: Scheduler;
  /** Reload orders, positions and fills after an acknowledgement timeout. Default true. */
  resyncOnTimeout?: boolean;
}

const isOrderUpdateFor =
  (finalOnly: boolean) =>
  (update: BrokerUpdate, targetId: string | undefined): boolean =>
    update.type === 'order' &&
    update.payload.id === targetId &&
    (!finalOnly || isFinalState(update.payload.state));

const isPositionUpdateFor = (update: BrokerUpdate, targetId: string | undefined): boolean =>
  update.type === 'position' && update.payload.id === targetId;

/**
 * tickdeck's side of the broker connection. It hands the connector an update
 * sink, keeps an in-memory view of orders, positions, fills and balance,
 * rejects updates that break the order lifecycle, and checks that every
 * action is acknowledged in time. Widgets read state and send actions through it.
 */
export class BrokerSession {
  readonly connector: BrokerConnector;
  readonly #events = new Emitter<BrokerSessionEvents>();
  readonly #watchdog: AckWatchdog;
  readonly #resyncOnTimeout: boolean;
  readonly #connection = new ObservableValue<BrokerConnection>({ state: 'disconnected' }, {
    equals: (a, b) => a.state === b.state && a.message === b.message,
  });
  readonly #balance = new ObservableValue<AccountBalance | undefined>(undefined);
  readonly #activeAccountId = new ObservableValue<string | undefined>(undefined);
  #orders = new Map<string, BrokerOrder>();
  #positions = new Map<string, BrokerPosition>();
  #fills = new Map<string, Fill>();
  #accounts: BrokerAccount[] = [];
  #capabilities: ResolvedBrokerCapabilities = resolveBrokerCapabilities({});
  readonly #rules = new Map<string, Promise<TradingRules>>();
  #started = false;

  /** Connection state as last reported by the connector. */
  readonly connection: ReadonlyObservableValue<BrokerConnection> = this.#connection.asReadonly();
  readonly balance: ReadonlyObservableValue<AccountBalance | undefined> = this.#balance.asReadonly();
  readonly activeAccountId: ReadonlyObservableValue<string | undefined> = this.#activeAccountId.asReadonly();

  readonly #sink: BrokerUpdateSink = {
    emit: <K extends keyof BrokerUpdates>(type: K, payload: BrokerUpdates[K]) => {
      this.#receive({ type, payload } as BrokerUpdate);
    },
  };

  constructor(connector: BrokerConnector, options: BrokerSessionOptions = {}) {
    this.connector = connector;
    this.#resyncOnTimeout = options.resyncOnTimeout ?? true;
    this.#watchdog = new AckWatchdog({
      timeoutMs: options.ackTimeoutMs,
      scheduler: options.scheduler,
      onTimeout: (error) => this.#onTimeout(error),
    });
  }

  on<K extends keyof BrokerSessionEvents>(event: K, listener: Listener<BrokerSessionEvents[K]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  once<K extends keyof BrokerSessionEvents>(event: K, listener: Listener<BrokerSessionEvents[K]>): Unsubscribe {
    return this.#events.once(event, listener);
  }

  get capabilities(): ResolvedBrokerCapabilities {
    return this.#capabilities;
  }

  get accounts(): readonly BrokerAccount[] {
    return this.#accounts;
  }

  /** Every known order, oldest first. */
  get orders(): BrokerOrder[] {
    return [...this.#orders.values()];
  }

  /** Open positions. */
  get positions(): BrokerPosition[] {
    return [...this.#positions.values()];
  }

  get fills(): Fill[] {
    return [...this.#fills.values()];
  }

  /** Actions still waiting for their acknowledging update. */
  get pendingAcks(): readonly PendingAck[] {
    return this.#watchdog.pending;
  }

  getOrder(id: string): BrokerOrder | undefined {
    return this.#orders.get(id);
  }

  getPosition(id: string): BrokerPosition | undefined {
    return this.#positions.get(id);
  }

  /**
   * Connects and loads capabilities, accounts, orders, positions, fills and
   * balance. `connection` reads `connecting` from the moment this is called,
   * then follows the connector. If anything fails, `connection` reads `error`
   * with the reason, the promise rejects, and `start()` can be called again.
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#connection.set({ state: 'connecting' });
    let connected = false;
    try {
      await this.connector.connect(this.#sink);
      connected = true;
      this.#capabilities = resolveBrokerCapabilities(await this.connector.getCapabilities());
      this.#connection.set(await this.connector.getConnection());
      await this.#loadAccount();
    } catch (error) {
      this.#started = false;
      if (connected) await this.connector.disconnect?.().catch(() => {});
      this.#connection.set({ state: 'error', message: errorMessage(error) });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#watchdog.dispose();
    await this.connector.disconnect?.();
    this.#connection.set({ state: 'disconnected' });
  }

  /** Reloads orders, positions, fills and balance from the connector and replaces the local view. */
  async resync(): Promise<void> {
    const [orders, positions, fills, balance] = await Promise.all([
      this.connector.listOrders(),
      this.connector.listPositions(),
      this.connector.listFills(),
      this.connector.getBalance?.(),
    ]);
    this.#applyResync({ orders, positions, fills, balance });
  }

  /** Trading rules for an instrument, cached per account. */
  getTradingRules(instrument: string): Promise<TradingRules> {
    let rules = this.#rules.get(instrument);
    if (!rules) {
      rules = this.connector.getTradingRules(instrument);
      rules.catch(() => this.#rules.delete(instrument));
      this.#rules.set(instrument, rules);
    }
    return rules;
  }

  async switchAccount(accountId: string): Promise<void> {
    this.#requireStarted();
    if (!this.connector.switchAccount) throw new BrokerError('unsupported', 'The broker has a single account');
    await this.connector.switchAccount(accountId);
    await this.#changeAccount(accountId);
  }

  async checkOrder(request: OrderRequest): Promise<OrderCheck> {
    this.#requireStarted();
    if (!this.connector.checkOrder) throw new BrokerError('unsupported', 'The broker cannot check orders');
    return this.connector.checkOrder(request);
  }

  /** Sends an order. Resolves with its id; the acknowledging update may still be on its way. */
  async submitOrder(request: OrderRequest, confirmationToken?: string): Promise<string> {
    this.#requireStarted();
    const ack = this.#watchdog.expect({ action: 'submit', matches: (update, id) => isSubmitAck(update, id) });
    let id: string;
    try {
      id = await this.connector.submitOrder(request, confirmationToken);
    } catch (error) {
      ack.cancel();
      throw error;
    }
    ack.setTarget(id);
    const known = this.#orders.get(id);
    if (known && known.state !== 'pending') ack.acknowledge();
    return id;
  }

  async amendOrder(orderId: string, changes: OrderAmendment, confirmationToken?: string): Promise<void> {
    this.#requireStarted();
    return this.#act({ action: 'amend', targetId: orderId, matches: isOrderUpdateFor(false) }, () =>
      this.connector.amendOrder(orderId, changes, confirmationToken),
    );
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.#requireStarted();
    return this.#act({ action: 'cancel', targetId: orderId, matches: isOrderUpdateFor(true) }, () =>
      this.connector.cancelOrder(orderId),
    );
  }

  /**
   * Closes a position, or `quantity` of it. Without native support (or for a
   * partial close the broker cannot do), sends an offsetting reduce-only
   * market order unless emulation is turned off.
   */
  async closePosition(positionId: string, quantity?: number): Promise<void> {
    this.#requireStarted();
    const position = this.#requirePosition(positionId);
    const partial = quantity !== undefined && quantity < position.quantity;
    const caps = this.#capabilities;
    const close = this.connector.closePosition;
    if (close && caps.closePosition && (!partial || caps.partialClose)) {
      return this.#act({ action: 'close', targetId: positionId, matches: isPositionUpdateFor }, () =>
        close.call(this.connector, positionId, quantity),
      );
    }
    if (!caps.emulation) throw new BrokerError('unsupported', 'The broker cannot close this position');
    await this.submitOrder({
      instrument: position.instrument,
      side: oppositeSide(position.side),
      kind: 'market',
      quantity: quantity ?? position.quantity,
      reduceOnly: true,
    });
  }

  /** Turns a position around. Emulated with a market order for twice the size when not supported natively. */
  async reversePosition(positionId: string): Promise<void> {
    this.#requireStarted();
    const position = this.#requirePosition(positionId);
    const reverse = this.connector.reversePosition;
    if (reverse && this.#capabilities.reversePosition) {
      return this.#act(
        {
          action: 'reverse',
          targetId: positionId,
          matches: (update, id) =>
            update.type === 'position' && (update.payload.id === id || update.payload.instrument === position.instrument),
        },
        () => reverse.call(this.connector, positionId),
      );
    }
    if (!this.#capabilities.emulation) throw new BrokerError('unsupported', 'The broker cannot reverse positions');
    await this.submitOrder({
      instrument: position.instrument,
      side: oppositeSide(position.side),
      kind: 'market',
      quantity: position.quantity * 2,
    });
  }

  async setPositionExits(positionId: string, exits: ProtectiveExits): Promise<void> {
    this.#requireStarted();
    this.#requirePosition(positionId);
    const set = this.connector.setPositionExits;
    if (!set || !this.#capabilities.positionExits) {
      throw new BrokerError('unsupported', 'The broker does not support exits on positions');
    }
    return this.#act(
      {
        action: 'set-exits',
        targetId: positionId,
        matches: (update, id) =>
          isPositionUpdateFor(update, id) ||
          (update.type === 'order' && update.payload.parent?.kind === 'position' && update.payload.parent.id === id),
      },
      () => set.call(this.connector, positionId, exits),
    );
  }

  async #act(expectation: AckExpectation, call: () => Promise<void>): Promise<void> {
    const ack = this.#watchdog.expect(expectation);
    try {
      await call();
    } catch (error) {
      ack.cancel();
      throw error;
    }
  }

  #requireStarted(): void {
    if (!this.#started) throw new BrokerError('not-started', 'Call start() before trading');
  }

  #requirePosition(positionId: string): BrokerPosition {
    const position = this.#positions.get(positionId);
    if (!position) throw new BrokerError('not-found', `Unknown position ${positionId}`);
    return position;
  }

  async #loadAccount(): Promise<void> {
    const [accounts, active] = await Promise.all([this.connector.listAccounts(), this.connector.getActiveAccount()]);
    this.#accounts = accounts;
    this.#activeAccountId.set(active);
    await this.resync();
  }

  async #changeAccount(accountId: string): Promise<void> {
    this.#activeAccountId.set(accountId);
    this.#rules.clear();
    await this.resync();
  }

  #onTimeout(error: AckTimeoutError): void {
    this.#events.emit('timeout', error);
    if (this.#resyncOnTimeout && this.#started) this.#inBackground(this.resync());
  }

  /** Reports a failed background reload as an error notice instead of an unhandled rejection. */
  #inBackground(work: Promise<void>): void {
    work.catch((cause: unknown) => {
      this.#events.emit('notice', {
        level: 'error',
        title: 'Could not reload trading state',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    });
  }

  #applyResync(snapshot: ResyncSnapshot): void {
    if (snapshot.orders) this.#orders = new Map(snapshot.orders.map((order) => [order.id, order]));
    if (snapshot.positions) {
      this.#positions = new Map(
        snapshot.positions.filter((position) => position.quantity > 0).map((position) => [position.id, position]),
      );
    }
    if (snapshot.fills) this.#fills = new Map(snapshot.fills.map((fill) => [fill.id, fill]));
    if (snapshot.balance) this.#balance.set(snapshot.balance);
    this.#events.emit('resync', snapshot);
  }

  #receive(update: BrokerUpdate): void {
    if (!this.#apply(update)) return;
    this.#watchdog.observe(update);
    this.#events.emit(update.type, update.payload as never);
  }

  /** Applies an update to the local view. Returns false when it was rejected. */
  #apply(update: BrokerUpdate): boolean {
    switch (update.type) {
      case 'order': {
        const order = update.payload;
        const problem = checkOrderUpdate(this.#orders.get(order.id), order);
        if (problem) {
          this.#events.emit('violation', problem);
          return false;
        }
        this.#orders.set(order.id, order);
        return true;
      }
      case 'position': {
        const position = update.payload;
        if (position.quantity > 0) this.#positions.set(position.id, position);
        else this.#positions.delete(position.id);
        return true;
      }
      case 'fill':
        if (this.#fills.has(update.payload.id)) return false;
        this.#fills.set(update.payload.id, update.payload);
        return true;
      case 'pnl': {
        const { positionId, unrealizedPnl, lastPrice } = update.payload;
        const position = this.#positions.get(positionId);
        if (position) {
          this.#positions.set(positionId, { ...position, unrealizedPnl, lastPrice: lastPrice ?? position.lastPrice });
        }
        return true;
      }
      case 'balance':
        this.#balance.set(update.payload);
        return true;
      case 'connection': {
        const wasConnected = this.#connection.value.state === 'connected';
        this.#connection.set(update.payload);
        if (this.#started && !wasConnected && update.payload.state === 'connected' && this.#accounts.length > 0) {
          this.#inBackground(this.resync());
        }
        return true;
      }
      case 'account':
        if (this.#activeAccountId.value !== update.payload.accountId) {
          this.#inBackground(this.#changeAccount(update.payload.accountId));
        }
        return true;
      case 'notice':
        return true;
      case 'resync':
        this.#applyResync(update.payload);
        return false;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSubmitAck(update: BrokerUpdate, targetId: string | undefined): boolean {
  return update.type === 'order' && update.payload.id === targetId && update.payload.state !== 'pending';
}
