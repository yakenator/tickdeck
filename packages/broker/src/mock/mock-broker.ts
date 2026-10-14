import {
  addExact,
  checkQuantity,
  isOnTick,
  microtask,
  multiplyExact,
  oppositeSide,
  subtractExact,
  systemScheduler,
  type Instrument,
  type QuantityProblem,
  type Quote,
  type QuoteSource,
  type Scheduler,
  type Unsubscribe,
} from '@tickdeck/core';
import type { BrokerConnector, BrokerUpdates, BrokerUpdateSink } from '../contract';
import { isWorkingState } from '../order-state';
import { applyFillToPosition, computeUnrealizedPnl, type FillEffect } from '../position-math';
import type {
  AccountBalance,
  BrokerAccount,
  BrokerCapabilities,
  BrokerConnection,
  BrokerOrder,
  BrokerPosition,
  ExitRole,
  Fill,
  OrderAmendment,
  OrderCheck,
  OrderRequest,
  ProtectiveExits,
  TradingRules,
} from '../types';

/** Quotes drive the simulation. A `MarketFeed` fits; `getInstrument` is used for trading rules when present. */
export interface MockBrokerFeed extends QuoteSource {
  getInstrument?(id: string): Promise<Instrument>;
}

export interface MockBrokerOptions {
  feed: MockBrokerFeed;
  /** Default: one demo account in USD. */
  accounts?: readonly BrokerAccount[];
  /** Opening cash balance of every account. Default 100000. */
  startingBalance?: number;
  /** Commission charged per unit of quantity filled. Default 0. */
  commissionPerUnit?: number;
  /** Trading rules per instrument, overriding what the feed reports. */
  rules?: Readonly<Record<string, Partial<TradingRules>>>;
  /** Delay before each update is pushed. Default 0 (next microtask). */
  latencyMs?: number;
  scheduler?: Scheduler;
}

interface OrderRecord {
  order: BrokerOrder;
  /** Has been evaluated against a quote and did not execute, so later fills happen at its limit price. */
  resting: boolean;
  /** Stop of a stop-limit order has triggered. */
  triggered: boolean;
}

interface Ledger {
  account: BrokerAccount;
  balance: number;
  realizedPnl: number;
  orders: Map<string, OrderRecord>;
  /** Open positions by instrument. */
  positions: Map<string, BrokerPosition>;
  fills: Fill[];
  lastBalance?: string;
}

const QUANTITY_MESSAGES: Record<QuantityProblem, string> = {
  'not-finite': 'is not a number',
  'not-positive': 'must be positive',
  'below-min': 'is below the minimum',
  'above-max': 'is above the maximum',
  'off-step': 'is not a multiple of the quantity step',
};

const EXIT_FIELD: Record<ExitRole, 'takeProfit' | 'stopLoss'> = {
  'take-profit': 'takeProfit',
  'stop-loss': 'stopLoss',
};

/**
 * In-memory `BrokerConnector` that simulates execution against a quote
 * stream, for development, demos and tests.
 *
 * - Market orders fill at the ask (buy) or bid (sell).
 * - Limit orders fill when the market reaches the limit: at the market price
 *   when marketable on arrival, at the limit price once resting.
 * - Stop orders become market orders when the ask (buy) or bid (sell)
 *   reaches the stop; stop-limit orders become limit orders.
 * - Take-profit and stop-loss exits wait as `held` until their entry fills,
 *   then protect the position for its full size; when one fills, the other is
 *   cancelled. Exits follow the position as it grows, shrinks or closes.
 * - One net position per instrument and account. Unrealized P&L, balance and
 *   equity are pushed as quotes move.
 * - `ioc`/`fok` orders cancel when not fillable on arrival; `gtd` orders
 *   expire at `expiresAt`; `day` behaves like `gtc`.
 *
 * Fills are always for the full remaining quantity.
 */
export class MockBroker implements BrokerConnector {
  readonly #feed: MockBrokerFeed;
  readonly #scheduler: Scheduler;
  readonly #latencyMs: number;
  readonly #commissionPerUnit: number;
  readonly #ruleOverrides: Readonly<Record<string, Partial<TradingRules>>>;
  readonly #ledgers = new Map<string, Ledger>();
  readonly #rules = new Map<string, TradingRules>();
  readonly #quotes = new Map<string, Quote>();
  readonly #watching = new Map<string, Unsubscribe>();
  readonly #checkTokens = new Set<string>();
  readonly #idleWaiters: (() => void)[] = [];
  #sink: BrokerUpdateSink | undefined;
  #connection: BrokerConnection = { state: 'disconnected' };
  #active: string;
  #queue: Promise<unknown> = Promise.resolve();
  #inflight = 0;
  #sequence = 0;

  constructor(options: MockBrokerOptions) {
    this.#feed = options.feed;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#latencyMs = options.latencyMs ?? 0;
    this.#commissionPerUnit = options.commissionPerUnit ?? 0;
    this.#ruleOverrides = options.rules ?? {};
    const accounts = options.accounts ?? [{ id: 'demo', name: 'Demo account', currency: 'USD', kind: 'demo' }];
    if (accounts.length === 0) throw new RangeError('MockBroker needs at least one account');
    for (const account of accounts) {
      this.#ledgers.set(account.id, {
        account: { ...account },
        balance: options.startingBalance ?? 100_000,
        realizedPnl: 0,
        orders: new Map(),
        positions: new Map(),
        fills: [],
      });
    }
    this.#active = (accounts[0] as BrokerAccount).id;
  }

  // ----- Connector contract -------------------------------------------------

  async connect(sink: BrokerUpdateSink): Promise<void> {
    this.#sink = sink;
    this.#connection = { state: 'connected' };
    this.#pushGlobal('connection', { ...this.#connection });
  }

  async disconnect(): Promise<void> {
    for (const unsubscribe of this.#watching.values()) unsubscribe();
    this.#watching.clear();
    this.#connection = { state: 'disconnected' };
    this.#pushGlobal('connection', { ...this.#connection });
  }

  async getCapabilities(): Promise<BrokerCapabilities> {
    return {
      orderKinds: ['market', 'limit', 'stop', 'stop-limit'],
      timeInForce: ['day', 'gtc', 'gtd', 'ioc', 'fok'],
      orderExits: true,
      positionExits: true,
      amendOrders: true,
      closePosition: true,
      partialClose: true,
      reversePosition: true,
      orderCheck: false,
      multipleAccounts: this.#ledgers.size > 1,
      emulation: true,
    };
  }

  async getConnection(): Promise<BrokerConnection> {
    return { ...this.#connection };
  }

  async listAccounts(): Promise<BrokerAccount[]> {
    return [...this.#ledgers.values()].map((ledger) => ({ ...ledger.account }));
  }

  async getActiveAccount(): Promise<string> {
    return this.#active;
  }

  switchAccount(accountId: string): Promise<void> {
    return this.#run(() => {
      if (!this.#ledgers.has(accountId)) throw new RangeError(`Unknown account ${accountId}`);
      this.#active = accountId;
      this.#pushGlobal('account', { accountId });
      this.#pushBalance(this.#ledger(), true);
    });
  }

  async listOrders(): Promise<BrokerOrder[]> {
    return [...this.#ledger().orders.values()].map((record) => copyOrder(record.order));
  }

  async listPositions(): Promise<BrokerPosition[]> {
    return [...this.#ledger().positions.values()].map((position) => ({ ...position }));
  }

  async listFills(instrument?: string): Promise<Fill[]> {
    return this.#ledger()
      .fills.filter((fill) => !instrument || fill.instrument === instrument)
      .map((fill) => ({ ...fill }));
  }

  async getBalance(): Promise<AccountBalance> {
    return this.#balanceOf(this.#ledger());
  }

  async getTradingRules(instrument: string): Promise<TradingRules> {
    return { ...(await this.#rulesFor(instrument)) };
  }

  submitOrder(request: OrderRequest, confirmationToken?: string): Promise<string> {
    return this.#run(() => this.#submit(this.#ledger(), request, confirmationToken));
  }

  amendOrder(orderId: string, changes: OrderAmendment): Promise<void> {
    return this.#run(() => this.#amend(this.#ledger(), orderId, changes));
  }

  cancelOrder(orderId: string): Promise<void> {
    return this.#run(() => {
      const ledger = this.#ledger();
      const record = this.#requireOrder(ledger, orderId);
      if (!isWorkingState(record.order.state)) throw new Error(`Order ${orderId} is already ${record.order.state}`);
      this.#cancel(ledger, record, 'Cancelled by user');
      this.#pushBalance(ledger);
    });
  }

  closePosition(positionId: string, quantity?: number): Promise<void> {
    return this.#run(async () => {
      const ledger = this.#ledger();
      const position = this.#requirePosition(ledger, positionId);
      const amount = quantity ?? position.quantity;
      if (!(amount > 0) || amount > position.quantity) {
        throw new RangeError(`Cannot close ${amount} of a ${position.quantity} position`);
      }
      await this.#submit(ledger, {
        instrument: position.instrument,
        side: oppositeSide(position.side),
        kind: 'market',
        quantity: amount,
        reduceOnly: true,
      });
    });
  }

  reversePosition(positionId: string): Promise<void> {
    return this.#run(async () => {
      const ledger = this.#ledger();
      const position = this.#requirePosition(ledger, positionId);
      await this.#submit(ledger, {
        instrument: position.instrument,
        side: oppositeSide(position.side),
        kind: 'market',
        quantity: multiplyExact(position.quantity, 2),
      });
    });
  }

  setPositionExits(positionId: string, exits: ProtectiveExits): Promise<void> {
    return this.#run(async () => {
      const ledger = this.#ledger();
      const position = this.#requirePosition(ledger, positionId);
      const rules = await this.#rulesFor(position.instrument);
      for (const role of ['take-profit', 'stop-loss'] as const) {
        const price = exits[EXIT_FIELD[role]];
        if (price === undefined) continue;
        const existing = this.#positionExits(ledger, position.id).find((record) => record.order.exitRole === role);
        if (price === null) {
          if (existing) this.#cancel(ledger, existing, 'Exit removed');
          continue;
        }
        if (!isOnTick(price, rules.tickSize)) throw new RangeError(`Price ${price} is not on the tick size ${rules.tickSize}`);
        if (existing) {
          setExitPrice(existing.order, price);
          existing.resting = false;
          existing.order.updatedAt = this.#scheduler.now();
          this.#pushOrder(ledger, existing);
        } else {
          const record = this.#createExit(ledger, position.side, position.instrument, position.quantity, role, price, {
            kind: 'position',
            id: position.id,
          });
          record.order.state = 'open';
          this.#pushOrder(ledger, record);
        }
      }
      this.#syncPositionExits(ledger, position);
      this.#push(ledger, 'position', { ...position });
      this.#evaluateInstrument(ledger, position.instrument);
      this.#pushBalance(ledger);
    });
  }

  checkOrder(request: OrderRequest): Promise<OrderCheck> {
    return this.#run(async () => {
      const ledger = this.#ledger();
      const rules = await this.#rulesFor(request.instrument);
      const problem = this.#validate(ledger, request, rules);
      const quote = await this.#quoteFor(request.instrument);
      const reference =
        request.limitPrice ?? request.stopPrice ?? (request.side === 'buy' ? quote?.ask : quote?.bid) ?? quote?.last;
      const pointValue = rules.pointValue ?? 1;
      const token = `check-${++this.#sequence}`;
      this.#checkTokens.add(token);
      const warnings: string[] = [];
      if (request.kind === 'market') warnings.push('Market orders fill at the current bid or ask.');
      return {
        confirmationToken: problem ? undefined : token,
        estimates: {
          cost: reference === undefined ? undefined : multiplyExact(reference, request.quantity, pointValue),
          commission: multiplyExact(this.#commissionPerUnit, request.quantity),
        },
        warnings,
        errors: problem ? [problem] : [],
      };
    });
  }

  // ----- Test helpers -------------------------------------------------------

  /** Resolves once every queued action has run and every update has been delivered. */
  async idle(): Promise<void> {
    for (;;) {
      const queue = this.#queue;
      await queue;
      if (this.#inflight > 0) {
        await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
        continue;
      }
      if (queue === this.#queue) return;
    }
  }

  // ----- Internals ----------------------------------------------------------

  /** Runs operations one at a time, in call order. */
  #run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #ledger(): Ledger {
    return this.#ledgers.get(this.#active) as Ledger;
  }

  #nextId(prefix: string): string {
    return `${prefix}-${++this.#sequence}`;
  }

  #requireOrder(ledger: Ledger, orderId: string): OrderRecord {
    const record = ledger.orders.get(orderId);
    if (!record) throw new RangeError(`Unknown order ${orderId}`);
    return record;
  }

  #requirePosition(ledger: Ledger, positionId: string): BrokerPosition {
    for (const position of ledger.positions.values()) if (position.id === positionId) return position;
    throw new RangeError(`Unknown position ${positionId}`);
  }

  #pushGlobal<K extends keyof BrokerUpdates>(type: K, payload: BrokerUpdates[K]): void {
    const sink = this.#sink;
    if (!sink) return;
    this.#inflight++;
    const deliver = () => {
      try {
        sink.emit(type, payload);
      } finally {
        this.#inflight--;
        if (this.#inflight === 0) for (const resolve of this.#idleWaiters.splice(0)) resolve();
      }
    };
    if (this.#latencyMs > 0) this.#scheduler.setTimeout(deliver, this.#latencyMs);
    else microtask(deliver);
  }

  /** Pushes an update that belongs to an account; only the active account's updates reach tickdeck. */
  #push<K extends keyof BrokerUpdates>(ledger: Ledger, type: K, payload: BrokerUpdates[K]): void {
    if (ledger.account.id === this.#active) this.#pushGlobal(type, payload);
  }

  #pushOrder(ledger: Ledger, record: OrderRecord): void {
    this.#push(ledger, 'order', copyOrder(record.order));
  }

  #notice(ledger: Ledger, notice: BrokerUpdates['notice']): void {
    this.#push(ledger, 'notice', notice);
  }

  async #rulesFor(instrument: string): Promise<TradingRules> {
    const cached = this.#rules.get(instrument);
    if (cached) return cached;
    let info: Instrument | undefined;
    try {
      info = await this.#feed.getInstrument?.(instrument);
    } catch {
      info = undefined;
    }
    const override = this.#ruleOverrides[instrument];
    const known = info !== undefined || override !== undefined;
    const rules: TradingRules = {
      instrument,
      tradable: known,
      reason: known ? undefined : `Unknown instrument ${instrument}`,
      tickSize: info?.tickSize ?? 0.01,
      pricePrecision: info?.pricePrecision,
      quantity: info?.quantity ?? { min: 1, step: 1 },
      pointValue: info?.pointValue ?? 1,
      currency: info?.currency ?? this.#ledger().account.currency,
      ...override,
    };
    this.#rules.set(instrument, rules);
    return rules;
  }

  #watch(instrument: string): void {
    if (this.#watching.has(instrument)) return;
    const unsubscribe = this.#feed.streamQuotes({ instruments: [instrument], focus: [instrument] }, (quotes) => {
      for (const quote of quotes) {
        if (quote.instrument === instrument) void this.#run(() => this.#onQuote(quote));
      }
    });
    this.#watching.set(instrument, unsubscribe);
  }

  async #quoteFor(instrument: string): Promise<Quote | undefined> {
    const cached = this.#quotes.get(instrument);
    if (cached) return cached;
    const [quote] = await this.#feed.loadQuotes([instrument]);
    if (quote && !this.#quotes.has(instrument)) this.#quotes.set(instrument, quote);
    return this.#quotes.get(instrument);
  }

  #validate(ledger: Ledger, request: OrderRequest, rules: TradingRules, token?: string): string | undefined {
    if (!rules.tradable) return rules.reason ?? `${request.instrument} cannot be traded`;
    if (rules.orderKinds && !rules.orderKinds.includes(request.kind)) return `${request.kind} orders are not allowed`;
    const quantityProblem = checkQuantity(request.quantity, rules.quantity);
    if (quantityProblem) return `Quantity ${request.quantity} ${QUANTITY_MESSAGES[quantityProblem]}`;
    const needsLimit = request.kind === 'limit' || request.kind === 'stop-limit';
    const needsStop = request.kind === 'stop' || request.kind === 'stop-limit';
    const prices: [string, number | undefined, boolean][] = [
      ['Limit price', request.limitPrice, needsLimit],
      ['Stop price', request.stopPrice, needsStop],
      ['Take-profit', request.takeProfit, false],
      ['Stop-loss', request.stopLoss, false],
    ];
    for (const [label, price, required] of prices) {
      if (price === undefined) {
        if (required) return `${label} is required for ${request.kind} orders`;
        continue;
      }
      if (!(price > 0)) return `${label} must be positive`;
      if (!isOnTick(price, rules.tickSize)) return `${label} ${price} is not on the tick size ${rules.tickSize}`;
    }
    const direction = request.side === 'buy' ? 1 : -1;
    const entry = needsLimit ? request.limitPrice : request.stopPrice;
    const { takeProfit, stopLoss } = request;
    if (takeProfit !== undefined && stopLoss !== undefined && (takeProfit - stopLoss) * direction <= 0) {
      return `Take-profit must be ${request.side === 'buy' ? 'above' : 'below'} the stop-loss`;
    }
    if (entry !== undefined && takeProfit !== undefined && (takeProfit - entry) * direction <= 0) {
      return `Take-profit must be ${request.side === 'buy' ? 'above' : 'below'} the entry price`;
    }
    if (entry !== undefined && stopLoss !== undefined && (entry - stopLoss) * direction <= 0) {
      return `Stop-loss must be ${request.side === 'buy' ? 'below' : 'above'} the entry price`;
    }
    if (request.timeInForce === 'gtd' && !(request.expiresAt !== undefined && request.expiresAt > this.#scheduler.now())) {
      return 'Good-till-date orders need a future expiry';
    }
    if (request.reduceOnly) {
      const position = ledger.positions.get(request.instrument);
      if (!position || position.side === request.side) return 'Reduce-only order has no position to reduce';
      if (request.quantity > position.quantity) return 'Reduce-only order is larger than the position';
    }
    if (token !== undefined && !this.#checkTokens.delete(token)) return 'Unknown or used confirmation token';
    return undefined;
  }

  async #submit(ledger: Ledger, request: OrderRequest, token?: string): Promise<string> {
    const rules = await this.#rulesFor(request.instrument);
    const order: BrokerOrder = {
      id: this.#nextId('ord'),
      accountId: ledger.account.id,
      instrument: request.instrument,
      side: request.side,
      kind: request.kind,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      timeInForce: request.timeInForce ?? 'gtc',
      expiresAt: request.expiresAt,
      state: 'pending',
      filledQuantity: 0,
      takeProfit: request.takeProfit,
      stopLoss: request.stopLoss,
      reduceOnly: request.reduceOnly,
      updatedAt: this.#scheduler.now(),
      meta: request.meta,
    };
    const record: OrderRecord = { order, resting: false, triggered: false };
    ledger.orders.set(order.id, record);
    this.#pushOrder(ledger, record);

    const problem = this.#validate(ledger, request, rules, token);
    if (problem) {
      this.#finish(ledger, record, 'rejected', problem);
      this.#notice(ledger, { level: 'error', title: 'Order rejected', message: problem, orderId: order.id });
      return order.id;
    }

    this.#watch(order.instrument);
    order.state = 'open';
    order.updatedAt = this.#scheduler.now();
    this.#pushOrder(ledger, record);
    for (const role of ['take-profit', 'stop-loss'] as const) {
      const price = order[EXIT_FIELD[role]];
      if (price === undefined) continue;
      const exit = this.#createExit(ledger, order.side, order.instrument, order.quantity, role, price, {
        kind: 'order',
        id: order.id,
      });
      this.#pushOrder(ledger, exit);
    }

    const quote = await this.#quoteFor(order.instrument);
    if (quote) {
      this.#evaluate(ledger, record, quote, true);
      this.#evaluateInstrument(ledger, order.instrument);
    } else if (order.timeInForce === 'ioc' || order.timeInForce === 'fok') {
      this.#cancel(ledger, record, 'No market to fill against');
    }
    this.#pushBalance(ledger);
    return order.id;
  }

  #createExit(
    ledger: Ledger,
    entrySide: BrokerOrder['side'],
    instrument: string,
    quantity: number,
    role: ExitRole,
    price: number,
    parent: NonNullable<BrokerOrder['parent']>,
  ): OrderRecord {
    const order: BrokerOrder = {
      id: this.#nextId('ord'),
      accountId: ledger.account.id,
      instrument,
      side: oppositeSide(entrySide),
      kind: role === 'take-profit' ? 'limit' : 'stop',
      quantity,
      timeInForce: 'gtc',
      state: 'held',
      filledQuantity: 0,
      parent: { ...parent },
      exitRole: role,
      reduceOnly: true,
      updatedAt: this.#scheduler.now(),
    };
    setExitPrice(order, price);
    const record: OrderRecord = { order, resting: false, triggered: false };
    ledger.orders.set(order.id, record);
    return record;
  }

  #amend(ledger: Ledger, orderId: string, changes: OrderAmendment): Promise<void> | void {
    const record = this.#requireOrder(ledger, orderId);
    const order = record.order;
    if (!isWorkingState(order.state)) throw new Error(`Order ${orderId} is already ${order.state}`);
    return this.#rulesFor(order.instrument).then((rules) => {
      const next: OrderRequest = {
        instrument: order.instrument,
        side: order.side,
        kind: order.kind,
        quantity: changes.quantity ?? order.quantity,
        limitPrice: changes.limitPrice ?? order.limitPrice,
        stopPrice: changes.stopPrice ?? order.stopPrice,
        timeInForce: changes.timeInForce ?? order.timeInForce,
        expiresAt: changes.expiresAt ?? order.expiresAt,
        takeProfit: changes.takeProfit === null ? undefined : (changes.takeProfit ?? order.takeProfit),
        stopLoss: changes.stopLoss === null ? undefined : (changes.stopLoss ?? order.stopLoss),
      };
      const problem = this.#validate(ledger, { ...next, reduceOnly: false }, rules);
      if (problem) throw new RangeError(problem);
      if (next.quantity < order.filledQuantity) throw new RangeError('Quantity is below the filled quantity');

      Object.assign(order, {
        quantity: next.quantity,
        limitPrice: next.limitPrice,
        stopPrice: next.stopPrice,
        timeInForce: next.timeInForce,
        expiresAt: next.expiresAt,
        updatedAt: this.#scheduler.now(),
      });
      record.resting = false;

      if (order.parent?.kind === 'position' && order.exitRole) {
        this.#pushOrder(ledger, record);
        const position = this.#requirePosition(ledger, order.parent.id);
        this.#syncPositionExits(ledger, position);
        this.#push(ledger, 'position', { ...position });
      } else if (!order.parent) {
        order.takeProfit = next.takeProfit;
        order.stopLoss = next.stopLoss;
        this.#pushOrder(ledger, record);
        this.#syncOrderExits(ledger, record);
      } else {
        this.#pushOrder(ledger, record);
        const entry = ledger.orders.get(order.parent.id);
        if (entry && order.exitRole) {
          entry.order[EXIT_FIELD[order.exitRole]] = order.exitRole === 'take-profit' ? order.limitPrice : order.stopPrice;
          entry.order.updatedAt = this.#scheduler.now();
          this.#pushOrder(ledger, entry);
        }
      }
      this.#evaluateInstrument(ledger, order.instrument);
      this.#pushBalance(ledger);
    });
  }

  /** Brings the held exits of a working entry order in line with its take-profit, stop-loss and quantity. */
  #syncOrderExits(ledger: Ledger, entry: OrderRecord): void {
    for (const role of ['take-profit', 'stop-loss'] as const) {
      const price = entry.order[EXIT_FIELD[role]];
      const existing = this.#children(ledger, entry.order.id).find((record) => record.order.exitRole === role);
      if (price === undefined) {
        if (existing) this.#cancel(ledger, existing, 'Exit removed');
      } else if (existing) {
        setExitPrice(existing.order, price);
        existing.order.quantity = entry.order.quantity;
        existing.order.updatedAt = this.#scheduler.now();
        this.#pushOrder(ledger, existing);
      } else {
        const created = this.#createExit(
          ledger,
          entry.order.side,
          entry.order.instrument,
          entry.order.quantity,
          role,
          price,
          { kind: 'order', id: entry.order.id },
        );
        this.#pushOrder(ledger, created);
      }
    }
  }

  #children(ledger: Ledger, orderId: string): OrderRecord[] {
    return [...ledger.orders.values()].filter(
      (record) =>
        record.order.parent?.kind === 'order' && record.order.parent.id === orderId && isWorkingState(record.order.state),
    );
  }

  #positionExits(ledger: Ledger, positionId: string): OrderRecord[] {
    return [...ledger.orders.values()].filter(
      (record) =>
        record.order.parent?.kind === 'position' &&
        record.order.parent.id === positionId &&
        isWorkingState(record.order.state),
    );
  }

  #syncPositionExits(ledger: Ledger, position: BrokerPosition): void {
    const exits = this.#positionExits(ledger, position.id);
    position.takeProfit = exits.find((record) => record.order.exitRole === 'take-profit')?.order.limitPrice;
    position.stopLoss = exits.find((record) => record.order.exitRole === 'stop-loss')?.order.stopPrice;
    position.updatedAt = this.#scheduler.now();
  }

  /** Moves an order to a final state and pushes it. */
  #finish(ledger: Ledger, record: OrderRecord, state: 'filled' | 'cancelled' | 'rejected', message?: string): void {
    record.order.state = state;
    record.order.updatedAt = this.#scheduler.now();
    if (message !== undefined) record.order.message = message;
    this.#pushOrder(ledger, record);
  }

  /** Cancels an order with its held exits, and clears it from its position if it was a position exit. */
  #cancel(ledger: Ledger, record: OrderRecord, message: string): void {
    this.#finish(ledger, record, 'cancelled', message);
    for (const child of this.#children(ledger, record.order.id)) this.#finish(ledger, child, 'cancelled', 'Entry order ended');
    const parent = record.order.parent;
    if (parent?.kind === 'position') {
      const position = [...ledger.positions.values()].find((candidate) => candidate.id === parent.id);
      if (position) {
        this.#syncPositionExits(ledger, position);
        this.#push(ledger, 'position', { ...position });
      }
    }
  }

  async #onQuote(quote: Quote): Promise<void> {
    this.#quotes.set(quote.instrument, quote);
    for (const ledger of this.#ledgers.values()) {
      this.#evaluateInstrument(ledger, quote.instrument);
      this.#markToMarket(ledger, quote.instrument);
      this.#pushBalance(ledger);
    }
  }

  /** Evaluates every working order of an instrument until nothing more executes. */
  #evaluateInstrument(ledger: Ledger, instrument: string): void {
    const quote = this.#quotes.get(instrument);
    if (!quote) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of ledger.orders.values()) {
        if (record.order.instrument !== instrument || record.order.state !== 'open') continue;
        if (this.#evaluate(ledger, record, quote, false)) {
          changed = true;
          break;
        }
      }
    }
  }

  /** Executes, triggers or expires one order against a quote. Returns true when the order ended. */
  #evaluate(ledger: Ledger, record: OrderRecord, quote: Quote, arriving: boolean): boolean {
    const order = record.order;
    if (order.state !== 'open') return false;
    const now = this.#scheduler.now();
    if (order.timeInForce === 'gtd' && order.expiresAt !== undefined && now >= order.expiresAt) {
      this.#cancel(ledger, record, 'Expired');
      return true;
    }
    const bid = quote.bid ?? quote.last;
    const ask = quote.ask ?? quote.last;
    if (bid === undefined || ask === undefined) return false;
    const buy = order.side === 'buy';
    const market = buy ? ask : bid;
    const reached = (stop: number) => (buy ? ask >= stop : bid <= stop);
    const limitFill = (limit: number) =>
      (buy ? market <= limit : market >= limit) ? (record.resting ? limit : market) : undefined;

    let price: number | undefined;
    switch (order.kind) {
      case 'market':
        price = market;
        break;
      case 'limit':
        price = limitFill(order.limitPrice as number);
        break;
      case 'stop':
        if (reached(order.stopPrice as number)) price = market;
        break;
      case 'stop-limit':
        if (!record.triggered && reached(order.stopPrice as number)) {
          record.triggered = true;
          record.resting = false;
        }
        if (record.triggered) price = limitFill(order.limitPrice as number);
        break;
    }

    if (price === undefined) {
      if (arriving && (order.timeInForce === 'ioc' || order.timeInForce === 'fok')) {
        this.#cancel(ledger, record, 'Could not fill immediately');
        return true;
      }
      record.resting = true;
      return false;
    }
    this.#execute(ledger, record, price);
    return true;
  }

  #execute(ledger: Ledger, record: OrderRecord, price: number): void {
    const order = record.order;
    const now = this.#scheduler.now();
    const rules = this.#rules.get(order.instrument) as TradingRules;
    const pointValue = rules.pointValue ?? 1;
    const before = ledger.positions.get(order.instrument);
    let quantity = subtractExact(order.quantity, order.filledQuantity);
    if (order.reduceOnly) {
      if (!before || before.side === order.side) {
        this.#cancel(ledger, record, 'No position left to reduce');
        return;
      }
      quantity = Math.min(quantity, before.quantity);
    }

    const effect = applyFillToPosition(before, order.side, quantity, price, pointValue);
    const positionId = before?.id ?? this.#nextId('pos');
    const commission = multiplyExact(this.#commissionPerUnit, quantity);
    const fill: Fill = {
      id: this.#nextId('fill'),
      orderId: order.id,
      positionId,
      instrument: order.instrument,
      side: order.side,
      price,
      quantity,
      time: now,
      commission,
      realizedPnl: effect.realizedPnl,
    };
    ledger.fills.push(fill);
    ledger.balance = subtractExact(addExact(ledger.balance, effect.realizedPnl), commission);
    ledger.realizedPnl = addExact(ledger.realizedPnl, effect.realizedPnl);

    order.filledQuantity = addExact(order.filledQuantity, quantity);
    order.averageFillPrice = price;
    order.state = order.filledQuantity >= order.quantity ? 'filled' : 'cancelled';
    if (order.state === 'cancelled') order.message = 'Reduced to the position size';
    order.updatedAt = now;
    this.#push(ledger, 'fill', { ...fill });
    this.#pushOrder(ledger, record);

    let position: BrokerPosition;
    if (effect.position) {
      position = {
        id: positionId,
        accountId: ledger.account.id,
        instrument: order.instrument,
        side: effect.position.side,
        quantity: effect.position.quantity,
        averagePrice: effect.position.averagePrice,
        realizedPnl: addExact(before?.realizedPnl ?? 0, effect.realizedPnl),
        updatedAt: now,
      };
      ledger.positions.set(order.instrument, position);
    } else {
      position = { ...(before as BrokerPosition), quantity: 0, unrealizedPnl: 0, updatedAt: now };
      position.realizedPnl = addExact(before?.realizedPnl ?? 0, effect.realizedPnl);
      ledger.positions.delete(order.instrument);
    }

    const exitUpdates = this.#reconcileExits(ledger, record, position, effect);
    if (effect.position) this.#syncPositionExits(ledger, position);
    else {
      position.takeProfit = undefined;
      position.stopLoss = undefined;
    }
    this.#markToMarket(ledger, order.instrument, false);
    this.#push(ledger, 'position', { ...position });
    for (const exit of exitUpdates) this.#pushOrder(ledger, exit);
  }

  /**
   * Updates protective exits after a fill changed a position. Returns the
   * exit orders that changed, to push after the position update.
   */
  #reconcileExits(ledger: Ledger, filled: OrderRecord, position: BrokerPosition, effect: FillEffect): OrderRecord[] {
    const changed: OrderRecord[] = [];
    const now = this.#scheduler.now();
    const close = (record: OrderRecord, message: string) => {
      record.order.state = 'cancelled';
      record.order.message = message;
      record.order.updatedAt = now;
      changed.push(record);
    };
    const current = this.#positionExits(ledger, position.id);
    const children = this.#children(ledger, filled.order.id);

    if (!effect.position) {
      for (const record of current) close(record, 'Position closed');
      for (const record of children) close(record, 'Position closed');
      return changed;
    }
    const grew = effect.flipped || filled.order.side === effect.position.side;
    if (grew && children.length > 0) {
      for (const record of current) close(record, 'Replaced by new exits');
      for (const record of children) {
        record.order.state = 'open';
        record.order.parent = { kind: 'position', id: position.id };
        record.order.quantity = position.quantity;
        record.order.updatedAt = now;
        changed.push(record);
      }
      return changed;
    }
    if (effect.flipped) {
      for (const record of current) close(record, 'Position reversed');
      return changed;
    }
    for (const record of children) close(record, 'Entry reduced the position');
    for (const record of current) {
      if (record.order.quantity === position.quantity) continue;
      record.order.quantity = position.quantity;
      record.order.updatedAt = now;
      changed.push(record);
    }
    return changed;
  }

  #markToMarket(ledger: Ledger, instrument: string, push = true): void {
    const position = ledger.positions.get(instrument);
    const quote = this.#quotes.get(instrument);
    if (!position || !quote) return;
    const mark = (position.side === 'buy' ? quote.bid : quote.ask) ?? quote.last;
    if (mark === undefined) return;
    const pointValue = this.#rules.get(instrument)?.pointValue ?? 1;
    const unrealizedPnl = computeUnrealizedPnl(position, mark, pointValue);
    if (unrealizedPnl === position.unrealizedPnl && mark === position.lastPrice) return;
    position.unrealizedPnl = unrealizedPnl;
    position.lastPrice = mark;
    if (push) this.#push(ledger, 'pnl', { positionId: position.id, unrealizedPnl, lastPrice: mark });
  }

  #balanceOf(ledger: Ledger): AccountBalance {
    const unrealizedPnl = addExact(...[...ledger.positions.values()].map((position) => position.unrealizedPnl ?? 0));
    return {
      accountId: ledger.account.id,
      currency: ledger.account.currency,
      balance: ledger.balance,
      equity: addExact(ledger.balance, unrealizedPnl),
      unrealizedPnl,
      realizedPnl: ledger.realizedPnl,
    };
  }

  #pushBalance(ledger: Ledger, force = false): void {
    const balance = this.#balanceOf(ledger);
    const signature = `${balance.balance}|${balance.equity}|${balance.realizedPnl}`;
    if (!force && signature === ledger.lastBalance) return;
    ledger.lastBalance = signature;
    this.#push(ledger, 'balance', balance);
  }
}

function setExitPrice(order: BrokerOrder, price: number): void {
  if (order.exitRole === 'take-profit') order.limitPrice = price;
  else order.stopPrice = price;
}

function copyOrder(order: BrokerOrder): BrokerOrder {
  return order.parent ? { ...order, parent: { ...order.parent } } : { ...order };
}
