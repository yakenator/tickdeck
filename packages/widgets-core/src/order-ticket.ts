import { isFinalState, isWorkingState, type BrokerOrder, type OrderAmendment, type OrderRequest } from '@tickdeck/broker';
import {
  addExact,
  checkQuantity,
  isOnTick,
  multiplyExact,
  roundQuantity,
  roundToTick,
  sideSign,
  subtractExact,
  ticksBetween,
  type OrderKind,
  type Quote,
  type QuantityProblem,
  type QuantityRules,
  type Side,
  type TimeInForce,
} from '@tickdeck/core';
import { describeTradingError, placeOrder, runAcknowledged } from './actions';
import type { ActionResult, WidgetAvailability, WidgetContext } from './context';
import { WidgetController } from './controller';
import { formatAmount } from './format';
import { InstrumentFormat, getInstrumentResolver, type InstrumentResolver, type TradableInstrument } from './instrument';
import { EXIT_ROLE_LABELS, SIDE_LABELS } from './labels';
import { QuoteWatcher, toQuoteDisplay, type QuoteDisplay } from './quotes';

/** The two protective exits, named as in `OrderRequest`. */
export type ExitField = 'takeProfit' | 'stopLoss';
/** An exit is entered as an absolute price or as a distance in ticks from the entry. */
export type ExitInputMode = 'price' | 'ticks';
export type TicketField = 'quantity' | 'limitPrice' | 'stopPrice' | 'expiresAt' | ExitField;
export type TicketPhase = 'editing' | 'checking' | 'review' | 'submitting';

export interface ExitDraft {
  enabled: boolean;
  mode: ExitInputMode;
  /** Entered price (price mode). */
  price: number | undefined;
  /** Entered distance in ticks (ticks mode). */
  ticks: number | undefined;
  /** The price that would be sent. */
  resolvedPrice: number | undefined;
  /** Distance from the entry in ticks, positive on the correct side. */
  resolvedTicks: number | undefined;
}

export interface EstimateItem {
  id: 'notional' | 'cost' | 'margin' | 'commission' | 'risk' | 'reward';
  label: string;
  value: number;
  /** Amount with currency, e.g. `995.00 USD`. */
  text: string;
}

/** A checked order waiting for the user's confirmation. */
export interface TicketReview {
  request: OrderRequest;
  confirmationToken?: string;
  estimates: readonly EstimateItem[];
  warnings: readonly string[];
}

export interface TicketEditable {
  instrument: boolean;
  side: boolean;
  kind: boolean;
  quantity: boolean;
  timeInForce: boolean;
  exits: boolean;
}

export interface OrderTicketState {
  mode: 'new' | 'amend';
  /** The order being changed, in amend mode. */
  amendOrder?: BrokerOrder;
  availability: WidgetAvailability;
  /** Why the ticket cannot be used, when `availability` is not `ready`. */
  reason?: string;
  instrumentId?: string;
  instrument?: TradableInstrument;
  side: Side;
  kind: OrderKind;
  quantity: number | undefined;
  limitPrice: number | undefined;
  stopPrice: number | undefined;
  timeInForce: TimeInForce | undefined;
  /** Expiry for `gtd`, UTC epoch milliseconds. */
  expiresAt: number | undefined;
  takeProfit: ExitDraft;
  stopLoss: ExitDraft;
  /** Order kinds the broker and the instrument allow. */
  orderKinds: readonly OrderKind[];
  timeInForceOptions: readonly TimeInForce[];
  /** Take-profit and stop-loss can be attached. */
  exitsAllowed: boolean;
  editable: Readonly<TicketEditable>;
  needsLimitPrice: boolean;
  needsStopPrice: boolean;
  quote?: QuoteDisplay;
  /** Entry price used for ticks, exits and estimates: the limit or stop price, or the ask (buy) or bid (sell) for market orders. */
  referencePrice?: number;
  /** Every problem that blocks submitting. */
  errors: Readonly<Partial<Record<TicketField, string>>>;
  /** Problems of fields the user has edited, or all after a submit attempt. */
  visibleErrors: Readonly<Partial<Record<TicketField, string>>>;
  warnings: readonly string[];
  estimates: readonly EstimateItem[];
  canSubmit: boolean;
  phase: TicketPhase;
  /** Checking or submitting. Inputs should be read-only. */
  busy: boolean;
  review?: TicketReview;
  result?: ActionResult;
  /** The order in words, e.g. `Buy 10 ACME limit 99.50`. */
  summary: string;
}

export interface OrderTicketEvents {
  placed: { orderId: string; request: OrderRequest };
  amended: { orderId: string; changes: OrderAmendment };
  error: { action: 'check' | 'submit' | 'amend'; error: unknown; message: string };
}

export interface OrderTicketOptions {
  instrument?: string;
  side?: Side;
  kind?: OrderKind;
  /** Default quantity. Falls back to the instrument's minimum. */
  quantity?: number;
  timeInForce?: TimeInForce;
  /**
   * Check every order with the broker (`checkOrder`) and ask for confirmation
   * before sending it. Default: the broker's `orderCheck` capability.
   */
  checkOrders?: boolean;
  /** How take-profit and stop-loss are entered at first. Default `price`. */
  exitMode?: ExitInputMode;
}

interface ExitInput {
  enabled: boolean;
  mode: ExitInputMode;
  price: number | undefined;
  ticks: number | undefined;
}

interface Inputs {
  side: Side;
  kind: OrderKind;
  quantity: number | undefined;
  limitPrice: number | undefined;
  stopPrice: number | undefined;
  timeInForce: TimeInForce | undefined;
  expiresAt: number | undefined;
  takeProfit: ExitInput;
  stopLoss: ExitInput;
}

const ALL_FIELDS: readonly TicketField[] = ['quantity', 'limitPrice', 'stopPrice', 'expiresAt', 'takeProfit', 'stopLoss'];
const EXIT_LABELS: Record<ExitField, string> = { takeProfit: EXIT_ROLE_LABELS['take-profit'], stopLoss: EXIT_ROLE_LABELS['stop-loss'] };

const needsLimit = (kind: OrderKind) => kind === 'limit' || kind === 'stop-limit';
const needsStop = (kind: OrderKind) => kind === 'stop' || kind === 'stop-limit';
const isNumber = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

function quantityProblem(quantity: number | undefined, rules: QuantityRules, format: InstrumentFormat): string | undefined {
  if (quantity === undefined) return 'Enter a quantity';
  const problem: QuantityProblem | undefined = checkQuantity(quantity, rules);
  switch (problem) {
    case undefined:
      return undefined;
    case 'not-finite':
      return 'Enter a number';
    case 'not-positive':
      return 'Quantity must be positive';
    case 'below-min':
      return `Minimum is ${format.quantity(rules.min)}`;
    case 'above-max':
      return `Maximum is ${format.quantity(rules.max)}`;
    case 'off-step':
      return isOnTick(rules.min, rules.step)
        ? `Use steps of ${format.quantity(rules.step)}`
        : `Use ${format.quantity(rules.min)} plus steps of ${format.quantity(rules.step)}`;
  }
}

function priceProblem(price: number | undefined, label: string, tickSize: number, format: InstrumentFormat): string | undefined {
  if (price === undefined) return `Enter a ${label} price`;
  if (!Number.isFinite(price)) return 'Enter a number';
  if (price <= 0) return 'Price must be positive';
  if (!isOnTick(price, tickSize)) {
    return `Use multiples of the tick size ${format.price(tickSize)} (nearest ${format.price(roundToTick(price, tickSize))})`;
  }
  return undefined;
}

function intersect<T>(allowed: readonly T[], narrower: readonly T[] | undefined): T[] {
  return narrower ? allowed.filter((item) => narrower.includes(item)) : [...allowed];
}

/**
 * Order entry: instrument, side, kind, quantity, prices, time in force and
 * protective exits, validated against the instrument's trading rules and the
 * live quote. Submits through the session and waits for the broker's
 * confirmation; optionally checks the order first and asks for confirmation.
 * In amend mode it edits an existing working order.
 */
export class OrderTicketController extends WidgetController<OrderTicketState, OrderTicketEvents> {
  readonly #resolver: InstrumentResolver;
  readonly #options: OrderTicketOptions;
  readonly #watcher: QuoteWatcher;
  #inputs: Inputs;
  #touched = new Set<TicketField>();
  #instrumentId: string | undefined;
  #instrument: TradableInstrument | undefined;
  #instrumentError: string | undefined;
  #loading: Promise<void> = Promise.resolve();
  #generation = 0;
  #quote: Quote | undefined;
  #phase: TicketPhase = 'editing';
  #review: TicketReview | undefined;
  #result: ActionResult | undefined;
  #amendOrder: BrokerOrder | undefined;
  #request: OrderRequest | undefined;
  #changes: OrderAmendment | undefined;

  constructor(context: WidgetContext, options: OrderTicketOptions = {}) {
    const inputs = defaultInputs(options, options.side ?? 'buy');
    super(context, blankState(inputs));
    this.#options = options;
    this.#inputs = inputs;
    this.#resolver = getInstrumentResolver(context);
    this.#watcher = new QuoteWatcher(context.feed, (quote) => this.#onQuote(quote));
    this.disposables.add(this.#watcher);
    const session = context.session;
    const update = () => this.#update();
    this.disposables.add(session.connection.subscribe(update));
    this.disposables.add(session.on('resync', update));
    this.disposables.add(session.on('account', () => void this.#loadInstrument(this.#instrumentId)));
    this.disposables.add(session.on('order', (order) => this.#onOrder(order)));
    if (options.instrument) void this.setInstrument(options.instrument);
    else this.#update();
  }

  /** Resolves once the current instrument's rules and metadata are loaded. */
  get ready(): Promise<void> {
    return this.#loading;
  }

  /** Switches the instrument. Leaves amend mode. Resolves once its rules are loaded. */
  setInstrument(instrument: string | undefined): Promise<void> {
    if (this.#busy()) return this.#loading;
    if (instrument === this.#instrumentId && !this.#instrumentError) {
      if (this.#amendOrder) {
        this.#leaveAmend();
        this.#update();
      }
      return this.#loading;
    }
    this.#amendOrder = undefined;
    this.#inputs = { ...defaultInputs(this.#options, this.#inputs.side), kind: this.#inputs.kind, timeInForce: this.#inputs.timeInForce, takeProfit: keepTicks(this.#inputs.takeProfit), stopLoss: keepTicks(this.#inputs.stopLoss) };
    this.#touched.clear();
    this.#result = undefined;
    this.#review = undefined;
    return this.#loadInstrument(instrument);
  }

  setSide(side: Side): void {
    if (!this.#editable().side || side === this.#inputs.side) return;
    this.#edit(undefined, { side, ...this.#untouchedPrices() });
  }

  setKind(kind: OrderKind): void {
    if (!this.#editable().kind || kind === this.#inputs.kind || !this.state.value.orderKinds.includes(kind)) return;
    this.#edit(undefined, { kind, ...this.#untouchedPrices() });
  }

  setQuantity(quantity: number | undefined): void {
    if (this.#editable().quantity) this.#edit('quantity', { quantity });
  }

  /** Moves the quantity by whole steps (negative to decrease), staying within the instrument's limits. */
  stepQuantity(steps: number): void {
    const rules = this.#instrument?.quantity;
    if (!rules || !this.#editable().quantity) return;
    const current = this.#inputs.quantity;
    let next: number;
    if (!isNumber(current)) next = rules.min;
    else if (checkQuantity(current, { min: rules.min, step: rules.step }) === undefined) {
      next = roundQuantity(addExact(current, multiplyExact(steps, rules.step)), rules);
    } else next = roundQuantity(current, rules, steps > 0 ? 'up' : 'down');
    this.#edit('quantity', { quantity: next });
  }

  setLimitPrice(limitPrice: number | undefined): void {
    if (this.#editable().prices) this.#edit('limitPrice', { limitPrice });
  }

  setStopPrice(stopPrice: number | undefined): void {
    if (this.#editable().prices) this.#edit('stopPrice', { stopPrice });
  }

  /** Puts a price (for example a clicked bid or ask) into the order's main price field. */
  usePrice(price: number): void {
    if (needsLimit(this.#inputs.kind) && this.#inputs.kind !== 'stop-limit') this.setLimitPrice(price);
    else if (needsStop(this.#inputs.kind)) this.setStopPrice(price);
  }

  /** Moves a price field by whole ticks, starting from the quote when it is empty. For exits in ticks mode, moves the distance. */
  stepPrice(field: 'limitPrice' | 'stopPrice' | ExitField, steps: number): void {
    const instrument = this.#instrument;
    if (!instrument) return;
    const tick = instrument.tickSize;
    if (field === 'takeProfit' || field === 'stopLoss') {
      const exit = this.#inputs[field];
      if (exit.mode === 'ticks') {
        this.setExitTicks(field, Math.max(1, Math.round(isNumber(exit.ticks) ? exit.ticks + steps : steps > 0 ? steps : 1)));
        return;
      }
      const start = isNumber(exit.price) ? exit.price : (this.state.value[field].resolvedPrice ?? this.state.value.referencePrice);
      if (start !== undefined) this.setExitPrice(field, stepTicks(start, steps, tick));
      return;
    }
    const current = this.#inputs[field];
    const start = isNumber(current) ? current : this.state.value.referencePrice ?? this.#quote?.last;
    if (start === undefined) return;
    const next = stepTicks(start, steps, tick);
    if (field === 'limitPrice') this.setLimitPrice(next);
    else this.setStopPrice(next);
  }

  setTimeInForce(timeInForce: TimeInForce): void {
    if (this.#editable().timeInForce) this.#edit(undefined, { timeInForce });
  }

  setExpiresAt(expiresAt: number | undefined): void {
    if (this.#editable().timeInForce) this.#edit('expiresAt', { expiresAt });
  }

  setExitEnabled(field: ExitField, enabled: boolean): void {
    if (!this.#editable().exits) return;
    this.#edit(undefined, { [field]: { ...this.#inputs[field], enabled } });
  }

  /** Switches between price and ticks entry, converting the current value. */
  setExitMode(field: ExitField, mode: ExitInputMode): void {
    if (!this.#editable().exits) return;
    const input = this.#inputs[field];
    if (input.mode === mode) return;
    const draft = this.state.value[field];
    const next: ExitInput =
      mode === 'ticks'
        ? { ...input, mode, ticks: draft.resolvedTicks !== undefined && draft.resolvedTicks > 0 ? Math.round(draft.resolvedTicks) : input.ticks }
        : { ...input, mode, price: draft.resolvedPrice ?? input.price };
    this.#edit(undefined, { [field]: next });
  }

  setExitPrice(field: ExitField, price: number | undefined): void {
    if (!this.#editable().exits) return;
    this.#edit(field, { [field]: { ...this.#inputs[field], enabled: true, mode: 'price', price } });
  }

  setExitTicks(field: ExitField, ticks: number | undefined): void {
    if (!this.#editable().exits) return;
    this.#edit(field, { [field]: { ...this.#inputs[field], enabled: true, mode: 'ticks', ticks } });
  }

  /**
   * Validates and sends the order (or the amendment). When orders are
   * checked first, this runs the check and moves to `review`; call `confirm`
   * to send. Resolves with false when nothing was sent or the broker refused.
   */
  async submit(): Promise<boolean> {
    if (this.#phase !== 'editing') return false;
    for (const field of ALL_FIELDS) this.#touched.add(field);
    this.#result = undefined;
    this.#update();
    const state = this.state.value;
    if (!state.canSubmit) {
      if (state.mode === 'amend' && state.availability === 'ready' && Object.keys(state.errors).length === 0) {
        this.#result = { level: 'info', message: 'Nothing to change' };
        this.#update();
      }
      return false;
    }
    if (this.#amendOrder) return this.#sendAmendment(this.#amendOrder, this.#changes ?? {});
    const request = this.#request as OrderRequest;
    if (this.#options.checkOrders ?? this.session.capabilities.orderCheck) return this.#check(request);
    return this.#send(request);
  }

  /** Sends the checked order shown in `review`. */
  confirm(): Promise<boolean> {
    const review = this.#review;
    if (this.#phase !== 'review' || !review) return Promise.resolve(false);
    return this.#send(review.request, review.confirmationToken);
  }

  /** Leaves the review without sending. */
  cancelReview(): void {
    if (this.#phase !== 'review') return;
    this.#phase = 'editing';
    this.#review = undefined;
    this.#update();
  }

  /** Loads a working order for editing. Submitting then amends it. */
  async amend(order: BrokerOrder): Promise<void> {
    if (this.#busy() || !isWorkingState(order.state)) return;
    this.#amendOrder = order;
    this.#phase = 'editing';
    this.#review = undefined;
    this.#result = undefined;
    const exit = (price: number | undefined, current: ExitInput): ExitInput => ({
      enabled: price !== undefined,
      mode: 'price',
      price,
      ticks: current.ticks,
    });
    this.#inputs = {
      side: order.side,
      kind: order.kind,
      quantity: order.quantity,
      limitPrice: order.limitPrice,
      stopPrice: order.stopPrice,
      timeInForce: order.timeInForce,
      expiresAt: order.expiresAt,
      takeProfit: exit(order.takeProfit, this.#inputs.takeProfit),
      stopLoss: exit(order.stopLoss, this.#inputs.stopLoss),
    };
    this.#touched = new Set(ALL_FIELDS);
    if (order.instrument !== this.#instrumentId || this.#instrumentError) await this.#loadInstrument(order.instrument);
    else this.#update();
  }

  /** Leaves amend mode and starts a fresh order for the same instrument. */
  cancelAmend(): void {
    if (!this.#amendOrder || this.#busy()) return;
    this.#leaveAmend();
    this.#update();
  }

  /** Clears entered values back to the defaults, keeping instrument and side. */
  reset(): void {
    if (this.#busy()) return;
    if (this.#amendOrder) this.#leaveAmend();
    this.#inputs = defaultInputs(this.#options, this.#inputs.side);
    this.#touched.clear();
    this.#result = undefined;
    this.#review = undefined;
    this.#normalize();
    this.#prefill();
    this.#update();
  }

  clearResult(): void {
    if (!this.#result) return;
    this.#result = undefined;
    this.#update();
  }

  #busy(): boolean {
    return this.#phase === 'checking' || this.#phase === 'submitting';
  }

  #editable(): TicketEditable & { prices: boolean } {
    const busy = this.#busy();
    const amending = this.#amendOrder !== undefined;
    const exits = this.state.value.exitsAllowed;
    return {
      instrument: !busy && !amending,
      side: !busy && !amending,
      kind: !busy && !amending,
      quantity: !busy,
      prices: !busy,
      timeInForce: !busy,
      exits: !busy && exits,
    };
  }

  #edit(field: TicketField | undefined, change: Partial<Inputs>): void {
    if (this.#busy()) return;
    this.#inputs = { ...this.#inputs, ...change };
    if (field) this.#touched.add(field);
    if (this.#phase === 'review') {
      this.#phase = 'editing';
      this.#review = undefined;
    }
    this.#result = undefined;
    this.#prefill();
    this.#update();
  }

  /** Price fields the user has not typed in, cleared so they can be filled again for the new side or kind. */
  #untouchedPrices(): Partial<Inputs> {
    if (this.#amendOrder) return {};
    const cleared: Partial<Inputs> = {};
    if (!this.#touched.has('limitPrice')) cleared.limitPrice = undefined;
    if (!this.#touched.has('stopPrice')) cleared.stopPrice = undefined;
    return cleared;
  }

  #leaveAmend(): void {
    this.#amendOrder = undefined;
    this.#inputs = defaultInputs(this.#options, this.#inputs.side);
    this.#touched.clear();
    this.#review = undefined;
    this.#normalize();
    this.#prefill();
  }

  #loadInstrument(instrument: string | undefined): Promise<void> {
    const generation = ++this.#generation;
    this.#instrumentId = instrument;
    this.#instrument = undefined;
    this.#instrumentError = undefined;
    this.#watcher.watch(instrument);
    this.#update();
    if (!instrument) {
      this.#loading = Promise.resolve();
      return this.#loading;
    }
    this.#loading = this.#resolver.get(instrument).then(
      (resolved) => {
        if (generation !== this.#generation || this.disposed) return;
        this.#instrument = resolved;
        this.#normalize();
        this.#prefill();
        this.#update();
      },
      (error: unknown) => {
        if (generation !== this.#generation || this.disposed) return;
        this.#instrumentError = describeTradingError(error);
        this.#update();
      },
    );
    return this.#loading;
  }

  /** Brings untouched defaults in line with the instrument's rules. */
  #normalize(): void {
    const instrument = this.#instrument;
    if (!instrument || this.#amendOrder) return;
    const rules = instrument.quantity;
    const { quantity } = this.#inputs;
    if (!this.#touched.has('quantity') && (quantity === undefined || checkQuantity(quantity, rules) !== undefined)) {
      const preferred = this.#options.quantity;
      this.#inputs.quantity = preferred !== undefined && checkQuantity(preferred, rules) === undefined ? preferred : rules.min;
    }
  }

  /** Fills empty, untouched price fields from the quote. */
  #prefill(): void {
    const instrument = this.#instrument;
    const quote = this.#quote;
    if (!instrument || !quote || this.#amendOrder) return;
    const tick = instrument.tickSize;
    const { side, kind } = this.#inputs;
    const buy = side === 'buy';
    const bid = quote.bid ?? quote.last;
    const ask = quote.ask ?? quote.last;
    if (needsStop(kind) && this.#inputs.stopPrice === undefined && !this.#touched.has('stopPrice')) {
      const base = buy ? ask : bid;
      if (base !== undefined) this.#inputs.stopPrice = roundToTick(addExact(base, buy ? tick : -tick), tick);
    }
    if (needsLimit(kind) && this.#inputs.limitPrice === undefined && !this.#touched.has('limitPrice')) {
      const base = kind === 'stop-limit' ? this.#inputs.stopPrice : buy ? bid : ask;
      if (base !== undefined) this.#inputs.limitPrice = roundToTick(base, tick);
    }
  }

  #onQuote(quote: Quote | undefined): void {
    this.#quote = quote;
    this.#prefill();
    this.#update();
  }

  #onOrder(order: BrokerOrder): void {
    const amending = this.#amendOrder;
    if (!amending || order.id !== amending.id || this.#busy()) return;
    if (isFinalState(order.state)) {
      this.#leaveAmend();
      this.#result = { level: 'info', message: `Order ${order.id} is ${order.state}; nothing left to change`, orderId: order.id };
    } else {
      this.#amendOrder = order;
    }
    this.#update();
  }

  async #check(request: OrderRequest): Promise<boolean> {
    this.#phase = 'checking';
    this.#update();
    try {
      const check = await this.session.checkOrder(request);
      if (check.errors && check.errors.length > 0) {
        const message = check.errors.join(' ');
        this.#result = { level: 'error', message };
        this.emit('error', { action: 'check', error: new Error(message), message });
        return false;
      }
      const currency = this.#instrument?.currency ?? '';
      const digits = this.#instrument?.moneyPrecision ?? 2;
      const estimates: EstimateItem[] = [];
      const add = (id: EstimateItem['id'], label: string, value: number | undefined) => {
        if (value !== undefined) estimates.push({ id, label, value, text: money(value, digits, currency) });
      };
      add('cost', 'Cost', check.estimates?.cost);
      add('margin', 'Margin', check.estimates?.margin);
      add('commission', 'Commission', check.estimates?.commission);
      this.#review = { request, confirmationToken: check.confirmationToken, estimates, warnings: check.warnings ?? [] };
      this.#phase = 'review';
      return true;
    } catch (error) {
      const message = describeTradingError(error);
      this.#result = { level: 'error', message };
      this.emit('error', { action: 'check', error, message });
      return false;
    } finally {
      if (this.#phase === 'checking') this.#phase = 'editing';
      this.#update();
    }
  }

  async #send(request: OrderRequest, confirmationToken?: string): Promise<boolean> {
    const summary = this.state.value.summary;
    this.#phase = 'submitting';
    this.#review = undefined;
    this.#update();
    try {
      const { orderId } = await placeOrder(this.session, request, confirmationToken);
      this.#result = { level: 'success', message: `Order placed: ${summary}`, orderId };
      this.emit('placed', { orderId, request });
      return true;
    } catch (error) {
      const message = describeTradingError(error);
      this.#result = { level: 'error', message };
      this.emit('error', { action: 'submit', error, message });
      return false;
    } finally {
      this.#phase = 'editing';
      this.#update();
    }
  }

  async #sendAmendment(order: BrokerOrder, changes: OrderAmendment): Promise<boolean> {
    this.#phase = 'submitting';
    this.#update();
    try {
      await runAcknowledged(this.session, 'amend', order.id, () => this.session.amendOrder(order.id, changes));
      this.#phase = 'editing';
      this.#leaveAmend();
      this.#result = { level: 'success', message: `Order ${order.id} changed`, orderId: order.id };
      this.emit('amended', { orderId: order.id, changes });
      return true;
    } catch (error) {
      const message = describeTradingError(error);
      this.#result = { level: 'error', message, orderId: order.id };
      this.emit('error', { action: 'amend', error, message });
      return false;
    } finally {
      this.#phase = 'editing';
      this.#update();
    }
  }

  #update(): void {
    if (this.disposed) return;
    const session = this.session;
    const caps = session.capabilities;
    const instrument = this.#instrument;
    const format = new InstrumentFormat(instrument);
    const amending = this.#amendOrder;
    const inputs = this.#inputs;
    const connection = session.connection.value;

    let availability: WidgetAvailability = 'ready';
    let reason: string | undefined;
    if (!this.#instrumentId) {
      availability = 'no-instrument';
      reason = 'Choose an instrument';
    } else if (connection.state !== 'connected') {
      availability = 'disconnected';
      reason = connection.message ?? 'Not connected to the broker';
    } else if (this.#instrumentError) {
      availability = 'error';
      reason = this.#instrumentError;
    } else if (!instrument) {
      availability = 'loading';
      reason = 'Loading instrument';
    } else if (!instrument.tradable) {
      availability = 'not-tradable';
      reason = instrument.reason ?? `${instrument.name} cannot be traded`;
    }

    const orderKinds = intersect(caps.orderKinds, instrument?.orderKinds);
    const timeInForceOptions = intersect(caps.timeInForce, instrument?.timeInForce);
    const kind = amending || orderKinds.includes(inputs.kind) || orderKinds.length === 0 ? inputs.kind : (orderKinds[0] as OrderKind);
    const timeInForce =
      inputs.timeInForce && (amending || timeInForceOptions.includes(inputs.timeInForce))
        ? inputs.timeInForce
        : timeInForceOptions.includes('gtc')
          ? 'gtc'
          : timeInForceOptions[0];
    if (amending?.timeInForce && !timeInForceOptions.includes(amending.timeInForce)) timeInForceOptions.push(amending.timeInForce);
    const exitsAllowed = caps.orderExits && !amending?.parent;
    const side = inputs.side;
    const buy = side === 'buy';
    const withLimit = needsLimit(kind);
    const withStop = needsStop(kind);
    const quote = this.#quote;
    const bid = quote?.bid ?? quote?.last;
    const ask = quote?.ask ?? quote?.last;
    const marketPrice = buy ? ask : bid;
    const entry = kind === 'market' ? marketPrice : withLimit ? inputs.limitPrice : inputs.stopPrice;
    const reference = isNumber(entry) ? entry : undefined;

    const errors: Partial<Record<TicketField, string>> = {};
    const warnings: string[] = [];
    const tick = instrument?.tickSize;
    const takeProfit = resolveExit('takeProfit', inputs.takeProfit, side, reference, tick, exitsAllowed);
    const stopLoss = resolveExit('stopLoss', inputs.stopLoss, side, reference, tick, exitsAllowed);

    if (instrument && tick !== undefined) {
      const quantityError = quantityProblem(inputs.quantity, instrument.quantity, format);
      if (quantityError) errors.quantity = quantityError;
      else if (amending && isNumber(inputs.quantity) && inputs.quantity < amending.filledQuantity) {
        errors.quantity = `At least ${format.quantity(amending.filledQuantity)} (already filled)`;
      }
      if (withLimit) {
        const problem = priceProblem(inputs.limitPrice, 'limit', tick, format);
        if (problem) errors.limitPrice = problem;
      }
      if (withStop) {
        const problem = priceProblem(inputs.stopPrice, 'stop', tick, format);
        if (problem) errors.stopPrice = problem;
      }
      const stop = inputs.stopPrice;
      const limit = inputs.limitPrice;
      if (withStop && !errors.stopPrice && isNumber(stop)) {
        if (buy && ask !== undefined && stop <= ask) errors.stopPrice = `A buy stop must be above the ask (${format.price(ask)})`;
        if (!buy && bid !== undefined && stop >= bid) errors.stopPrice = `A sell stop must be below the bid (${format.price(bid)})`;
      }
      if (kind === 'limit' && !errors.limitPrice && isNumber(limit)) {
        if (buy && ask !== undefined && limit >= ask) {
          warnings.push(`The limit is at or above the ask (${format.price(ask)}), so the order fills at once`);
        }
        if (!buy && bid !== undefined && limit <= bid) {
          warnings.push(`The limit is at or below the bid (${format.price(bid)}), so the order fills at once`);
        }
      }
      if (kind === 'stop-limit' && isNumber(limit) && isNumber(stop) && !errors.limitPrice && !errors.stopPrice) {
        if (buy && limit < stop) warnings.push('The limit is below the stop, so the order may not fill once triggered');
        if (!buy && limit > stop) warnings.push('The limit is above the stop, so the order may not fill once triggered');
      }
      if (timeInForce === 'gtd') {
        const expiresAt = inputs.expiresAt;
        if (expiresAt === undefined) errors.expiresAt = 'Choose an expiry';
        else if (!Number.isFinite(expiresAt)) errors.expiresAt = 'Enter a valid date and time';
        else if (expiresAt <= this.scheduler.now()) errors.expiresAt = 'Expiry must be in the future';
      }
      if (exitsAllowed) {
        const entryLabel = kind === 'market' ? (buy ? 'the ask' : 'the bid') : 'the entry price';
        for (const [field, input, draft] of [
          ['takeProfit', inputs.takeProfit, takeProfit],
          ['stopLoss', inputs.stopLoss, stopLoss],
        ] as const) {
          if (!input.enabled) continue;
          const label = EXIT_LABELS[field];
          let problem: string | undefined;
          if (input.mode === 'ticks') {
            if (input.ticks === undefined) problem = 'Enter a distance in ticks';
            else if (!Number.isInteger(input.ticks) || input.ticks <= 0) problem = 'Use a whole number of ticks above zero';
            else if (reference === undefined) problem = kind === 'market' ? 'Waiting for a market price' : 'Enter the entry price first';
          } else {
            problem = priceProblem(input.price, label.toLowerCase(), tick, format);
          }
          if (!problem && reference !== undefined && draft.resolvedTicks !== undefined && draft.resolvedTicks <= 0) {
            const above = (field === 'takeProfit') === buy;
            problem = `${label} must be ${above ? 'above' : 'below'} ${entryLabel} (${format.price(reference)})`;
          }
          if (problem) errors[field] = problem;
        }
      }
    }

    const quantity = isNumber(inputs.quantity) ? inputs.quantity : undefined;
    const estimates: EstimateItem[] = [];
    if (instrument && quantity !== undefined && !errors.quantity && reference !== undefined) {
      const { pointValue, currency, moneyPrecision: digits } = instrument;
      const add = (id: EstimateItem['id'], label: string, value: number) =>
        estimates.push({ id, label, value, text: money(value, digits, currency) });
      const notional = multiplyExact(reference, quantity, pointValue);
      add('notional', 'Notional', notional);
      if (instrument.marginRate !== undefined) add('margin', 'Margin', multiplyExact(notional, instrument.marginRate));
      if (stopLoss.resolvedPrice !== undefined && !errors.stopLoss) {
        add('risk', 'Risk to stop-loss', multiplyExact(Math.abs(subtractExact(reference, stopLoss.resolvedPrice)), quantity, pointValue));
      }
      if (takeProfit.resolvedPrice !== undefined && !errors.takeProfit) {
        add('reward', 'Reward to take-profit', multiplyExact(Math.abs(subtractExact(takeProfit.resolvedPrice, reference)), quantity, pointValue));
      }
    }

    const valid = availability === 'ready' && Object.keys(errors).length === 0 && orderKinds.includes(kind);
    this.#request = undefined;
    this.#changes = undefined;
    if (valid && this.#instrumentId && quantity !== undefined) {
      if (amending) {
        this.#changes = amendmentOf(amending, {
          quantity,
          limitPrice: withLimit ? inputs.limitPrice : undefined,
          stopPrice: withStop ? inputs.stopPrice : undefined,
          timeInForce,
          expiresAt: timeInForce === 'gtd' ? inputs.expiresAt : undefined,
          takeProfit: exitsAllowed ? takeProfit.resolvedPrice : amending.takeProfit,
          stopLoss: exitsAllowed ? stopLoss.resolvedPrice : amending.stopLoss,
        });
      } else {
        this.#request = {
          instrument: this.#instrumentId,
          side,
          kind,
          quantity,
          ...(withLimit ? { limitPrice: inputs.limitPrice } : {}),
          ...(withStop ? { stopPrice: inputs.stopPrice } : {}),
          ...(timeInForce ? { timeInForce } : {}),
          ...(timeInForce === 'gtd' ? { expiresAt: inputs.expiresAt } : {}),
          ...(takeProfit.resolvedPrice !== undefined ? { takeProfit: takeProfit.resolvedPrice } : {}),
          ...(stopLoss.resolvedPrice !== undefined ? { stopLoss: stopLoss.resolvedPrice } : {}),
        };
      }
    }
    const hasChanges = this.#changes !== undefined && Object.keys(this.#changes).length > 0;
    const visibleErrors: Partial<Record<TicketField, string>> = {};
    for (const [field, message] of Object.entries(errors) as [TicketField, string][]) {
      if (this.#touched.has(field)) visibleErrors[field] = message;
    }
    const busy = this.#busy();

    this.setState({
      mode: amending ? 'amend' : 'new',
      amendOrder: amending,
      availability,
      reason,
      instrumentId: this.#instrumentId,
      instrument,
      side,
      kind,
      quantity: inputs.quantity,
      limitPrice: inputs.limitPrice,
      stopPrice: inputs.stopPrice,
      timeInForce,
      expiresAt: inputs.expiresAt,
      takeProfit,
      stopLoss,
      orderKinds,
      timeInForceOptions,
      exitsAllowed,
      editable: {
        instrument: !busy && !amending,
        side: !busy && !amending,
        kind: !busy && !amending,
        quantity: !busy,
        timeInForce: !busy,
        exits: !busy && exitsAllowed,
      },
      needsLimitPrice: withLimit,
      needsStopPrice: withStop,
      quote: toQuoteDisplay(quote, format),
      referencePrice: reference,
      errors,
      visibleErrors,
      warnings,
      estimates,
      canSubmit: valid && this.#phase === 'editing' && (amending ? hasChanges : this.#request !== undefined),
      phase: this.#phase,
      busy,
      review: this.#review,
      result: this.#result,
      summary: summarize(side, kind, inputs, format, this.#instrumentId, amending),
    });
  }
}

function defaultInputs(options: OrderTicketOptions, side: Side): Inputs {
  const exit = (): ExitInput => ({ enabled: false, mode: options.exitMode ?? 'price', price: undefined, ticks: undefined });
  return {
    side,
    kind: options.kind ?? 'market',
    quantity: options.quantity,
    limitPrice: undefined,
    stopPrice: undefined,
    timeInForce: options.timeInForce,
    expiresAt: undefined,
    takeProfit: exit(),
    stopLoss: exit(),
  };
}

function keepTicks(input: ExitInput): ExitInput {
  return input.mode === 'ticks' ? input : { ...input, price: undefined };
}

function blankExit(input: ExitInput): ExitDraft {
  return { ...input, resolvedPrice: undefined, resolvedTicks: undefined };
}

function blankState(inputs: Inputs): OrderTicketState {
  return {
    mode: 'new',
    availability: 'no-instrument',
    side: inputs.side,
    kind: inputs.kind,
    quantity: inputs.quantity,
    limitPrice: undefined,
    stopPrice: undefined,
    timeInForce: inputs.timeInForce,
    expiresAt: undefined,
    takeProfit: blankExit(inputs.takeProfit),
    stopLoss: blankExit(inputs.stopLoss),
    orderKinds: [],
    timeInForceOptions: [],
    exitsAllowed: false,
    editable: { instrument: true, side: true, kind: true, quantity: true, timeInForce: true, exits: false },
    needsLimitPrice: needsLimit(inputs.kind),
    needsStopPrice: needsStop(inputs.kind),
    errors: {},
    visibleErrors: {},
    warnings: [],
    estimates: [],
    canSubmit: false,
    phase: 'editing',
    busy: false,
    summary: '',
  };
}

function stepTicks(price: number, steps: number, tick: number): number {
  if (isOnTick(price, tick)) return roundToTick(addExact(price, multiplyExact(steps, tick)), tick);
  return roundToTick(price, tick, steps > 0 ? 'up' : 'down');
}

/**
 * Turns an exit input into the price to send. Take-profit lies above the entry
 * for a buy and below for a sell; stop-loss the other way round.
 */
function resolveExit(
  field: ExitField,
  input: ExitInput,
  side: Side,
  reference: number | undefined,
  tick: number | undefined,
  allowed: boolean,
): ExitDraft {
  if (!input.enabled || !allowed || tick === undefined) return blankExit(input);
  const direction = (field === 'takeProfit' ? 1 : -1) * sideSign(side);
  if (input.mode === 'ticks') {
    const ticks = input.ticks;
    const usable = isNumber(ticks) && Number.isInteger(ticks) && ticks > 0;
    const resolvedPrice =
      usable && reference !== undefined ? roundToTick(addExact(reference, multiplyExact(direction, ticks, tick)), tick) : undefined;
    return { ...input, resolvedPrice, resolvedTicks: usable ? ticks : undefined };
  }
  const price = isNumber(input.price) ? input.price : undefined;
  const resolvedTicks = price !== undefined && reference !== undefined ? direction * ticksBetween(reference, price, tick) : undefined;
  return { ...input, resolvedPrice: price, resolvedTicks };
}

function amendmentOf(order: BrokerOrder, next: Required<Pick<OrderAmendment, 'quantity'>> & Omit<OrderAmendment, 'quantity'>): OrderAmendment {
  const changes: OrderAmendment = {};
  if (next.quantity !== order.quantity) changes.quantity = next.quantity;
  if (next.limitPrice !== undefined && next.limitPrice !== order.limitPrice) changes.limitPrice = next.limitPrice;
  if (next.stopPrice !== undefined && next.stopPrice !== order.stopPrice) changes.stopPrice = next.stopPrice;
  if (next.timeInForce !== undefined && next.timeInForce !== order.timeInForce) changes.timeInForce = next.timeInForce;
  if (next.expiresAt !== undefined && next.expiresAt !== order.expiresAt) changes.expiresAt = next.expiresAt;
  if ((next.takeProfit ?? undefined) !== order.takeProfit) changes.takeProfit = next.takeProfit ?? null;
  if ((next.stopLoss ?? undefined) !== order.stopLoss) changes.stopLoss = next.stopLoss ?? null;
  return changes;
}

function money(value: number, digits: number, currency: string): string {
  const amount = formatAmount(value, digits);
  return currency ? `${amount} ${currency}` : amount;
}

function summarize(
  side: Side,
  kind: OrderKind,
  inputs: Inputs,
  format: InstrumentFormat,
  instrumentId: string | undefined,
  amending: BrokerOrder | undefined,
): string {
  const quantity = isNumber(inputs.quantity) ? format.quantity(inputs.quantity) : '';
  const name = format.name || instrumentId || '';
  const price = (value: number | undefined) => (isNumber(value) ? format.price(value) : '…');
  let terms: string;
  switch (kind) {
    case 'market':
      terms = 'at market';
      break;
    case 'limit':
      terms = `limit ${price(inputs.limitPrice)}`;
      break;
    case 'stop':
      terms = `stop ${price(inputs.stopPrice)}`;
      break;
    case 'stop-limit':
      terms = `stop ${price(inputs.stopPrice)} limit ${price(inputs.limitPrice)}`;
      break;
  }
  const text = [SIDE_LABELS[side], quantity, name, amending?.exitRole ? EXIT_ROLE_LABELS[amending.exitRole].toLowerCase() : '', terms]
    .filter(Boolean)
    .join(' ');
  return amending ? `Change: ${text}` : text;
}

