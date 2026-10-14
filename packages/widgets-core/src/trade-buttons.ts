import type { OrderRequest } from '@tickdeck/broker';
import {
  addExact,
  checkQuantity,
  multiplyExact,
  roundQuantity,
  type Quote,
  type Side,
  type TimerHandle,
} from '@tickdeck/core';
import { describeTradingError, placeOrder } from './actions';
import type { ActionResult, WidgetAvailability, WidgetContext } from './context';
import { WidgetController } from './controller';
import { InstrumentFormat, getInstrumentResolver, type InstrumentResolver, type TradableInstrument } from './instrument';
import { SIDE_LABELS } from './labels';
import { QuoteWatcher, toQuoteDisplay, type QuoteDisplay } from './quotes';

export interface TradeSideView {
  side: Side;
  /** `Buy` or `Sell`. */
  label: string;
  /** The ask for buy, the bid for sell. */
  price?: number;
  priceText: string;
  enabled: boolean;
  /** Why the button is disabled. */
  reason?: string;
  /** The order in words, e.g. `Buy 10 ACME at market`. */
  description: string;
}

export interface TradeButtonsState {
  availability: WidgetAvailability;
  reason?: string;
  instrumentId?: string;
  instrument?: TradableInstrument;
  quote?: QuoteDisplay;
  quantity: number | undefined;
  quantityError?: string;
  /** Orders need a second, confirming action. */
  confirm: boolean;
  /** The side waiting for confirmation. */
  armed?: Side;
  /** The side whose order is waiting for the broker. */
  busy?: Side;
  buy: TradeSideView;
  sell: TradeSideView;
  result?: ActionResult;
}

export interface TradeButtonsEvents {
  placed: { orderId: string; request: OrderRequest };
  error: { side: Side; error: unknown; message: string };
}

export interface TradeButtonsOptions {
  instrument?: string;
  /** Default quantity. Falls back to the instrument's minimum. */
  quantity?: number;
  /** Ask for confirmation before each order. Default false. */
  confirm?: boolean;
  /** How long a pending confirmation stays armed. Default 10000. */
  confirmTimeoutMs?: number;
}

const sideView = (side: Side): TradeSideView => ({
  side,
  label: SIDE_LABELS[side],
  priceText: '',
  enabled: false,
  description: SIDE_LABELS[side],
});

/**
 * One-click market orders for one instrument, with live bid, ask and spread.
 * Each side is enabled only when an order could be sent, and says why not
 * otherwise. In confirm mode, `trade` arms a side and `confirmTrade` sends.
 */
export class TradeButtonsController extends WidgetController<TradeButtonsState, TradeButtonsEvents> {
  readonly #resolver: InstrumentResolver;
  readonly #options: TradeButtonsOptions;
  readonly #watcher: QuoteWatcher;
  #instrumentId: string | undefined;
  #instrument: TradableInstrument | undefined;
  #instrumentError: string | undefined;
  #loading: Promise<void> = Promise.resolve();
  #generation = 0;
  #quote: Quote | undefined;
  #quantity: number | undefined;
  #quantityTouched = false;
  #confirm: boolean;
  #armed: Side | undefined;
  #armTimer: TimerHandle | undefined;
  #busy: Side | undefined;
  #result: ActionResult | undefined;

  constructor(context: WidgetContext, options: TradeButtonsOptions = {}) {
    super(context, {
      availability: 'no-instrument',
      quantity: options.quantity,
      confirm: options.confirm ?? false,
      buy: sideView('buy'),
      sell: sideView('sell'),
    });
    this.#options = options;
    this.#quantity = options.quantity;
    this.#confirm = options.confirm ?? false;
    this.#resolver = getInstrumentResolver(context);
    this.#watcher = new QuoteWatcher(context.feed, (quote) => {
      this.#quote = quote;
      this.#update();
    });
    this.disposables.add(this.#watcher);
    this.disposables.add(() => this.#disarm());
    const session = context.session;
    const update = () => this.#update();
    this.disposables.add(session.connection.subscribe(update));
    this.disposables.add(session.on('resync', update));
    this.disposables.add(session.on('account', () => void this.#load(this.#instrumentId)));
    if (options.instrument) void this.setInstrument(options.instrument);
    else this.#update();
  }

  /** Resolves once the current instrument's rules are loaded. */
  get ready(): Promise<void> {
    return this.#loading;
  }

  setInstrument(instrument: string | undefined): Promise<void> {
    if (instrument === this.#instrumentId && !this.#instrumentError) return this.#loading;
    this.#disarm();
    this.#result = undefined;
    this.#quantityTouched = false;
    this.#quantity = this.#options.quantity;
    return this.#load(instrument);
  }

  setQuantity(quantity: number | undefined): void {
    this.#quantity = quantity;
    this.#quantityTouched = true;
    this.#disarm();
    this.#update();
  }

  stepQuantity(steps: number): void {
    const rules = this.#instrument?.quantity;
    if (!rules) return;
    const current = this.#quantity;
    let next: number;
    if (current === undefined || !Number.isFinite(current)) next = rules.min;
    else if (checkQuantity(current, { min: rules.min, step: rules.step }) === undefined) {
      next = roundQuantity(addExact(current, multiplyExact(steps, rules.step)), rules);
    } else next = roundQuantity(current, rules, steps > 0 ? 'up' : 'down');
    this.setQuantity(next);
  }

  setConfirm(confirm: boolean): void {
    if (confirm === this.#confirm) return;
    this.#confirm = confirm;
    this.#disarm();
    this.#update();
  }

  buy(): Promise<boolean> {
    return this.trade('buy');
  }

  sell(): Promise<boolean> {
    return this.trade('sell');
  }

  /**
   * Sends a market order for the current quantity. In confirm mode the first
   * call only arms the side; `confirmTrade` sends it.
   */
  async trade(side: Side): Promise<boolean> {
    if (!this.state.value[side].enabled) return false;
    if (this.#confirm) {
      this.#arm(side);
      return false;
    }
    return this.#place(side);
  }

  /** Sends the armed order. */
  confirmTrade(): Promise<boolean> {
    const side = this.#armed;
    this.#disarm();
    if (!side || !this.state.value[side].enabled) {
      this.#update();
      return Promise.resolve(false);
    }
    return this.#place(side);
  }

  cancelTrade(): void {
    if (!this.#armed) return;
    this.#disarm();
    this.#update();
  }

  clearResult(): void {
    if (!this.#result) return;
    this.#result = undefined;
    this.#update();
  }

  #arm(side: Side): void {
    this.#disarm();
    this.#armed = side;
    this.#result = undefined;
    const timeout = this.#options.confirmTimeoutMs ?? 10_000;
    if (timeout > 0) {
      this.#armTimer = this.scheduler.setTimeout(() => {
        this.#armTimer = undefined;
        this.cancelTrade();
      }, timeout);
    }
    this.#update();
  }

  #disarm(): void {
    this.#armed = undefined;
    if (this.#armTimer !== undefined) this.scheduler.clearTimeout(this.#armTimer);
    this.#armTimer = undefined;
  }

  async #place(side: Side): Promise<boolean> {
    const instrument = this.#instrumentId;
    const quantity = this.#quantity;
    if (!instrument || quantity === undefined) return false;
    const description = this.state.value[side].description;
    const request: OrderRequest = { instrument, side, kind: 'market', quantity };
    this.#busy = side;
    this.#result = undefined;
    this.#update();
    try {
      const { orderId } = await placeOrder(this.session, request);
      this.#result = { level: 'success', message: `Order placed: ${description}`, orderId };
      this.emit('placed', { orderId, request });
      return true;
    } catch (error) {
      const message = describeTradingError(error);
      this.#result = { level: 'error', message };
      this.emit('error', { side, error, message });
      return false;
    } finally {
      this.#busy = undefined;
      this.#update();
    }
  }

  #load(instrument: string | undefined): Promise<void> {
    const generation = ++this.#generation;
    this.#instrumentId = instrument;
    this.#instrument = undefined;
    this.#instrumentError = undefined;
    this.#watcher.watch(instrument);
    if (!instrument) {
      this.#loading = Promise.resolve();
      this.#update();
      return this.#loading;
    }
    this.#loading = this.#resolver.get(instrument).then(
      (resolved) => {
        if (generation !== this.#generation || this.disposed) return;
        this.#instrument = resolved;
        const preferred = this.#quantity;
        if (!this.#quantityTouched && (preferred === undefined || checkQuantity(preferred, resolved.quantity) !== undefined)) {
          this.#quantity = resolved.quantity.min;
        }
        this.#update();
      },
      (error: unknown) => {
        if (generation !== this.#generation || this.disposed) return;
        this.#instrumentError = describeTradingError(error);
        this.#update();
      },
    );
    this.#update();
    return this.#loading;
  }

  #update(): void {
    if (this.disposed) return;
    const session = this.session;
    const instrument = this.#instrument;
    const format = new InstrumentFormat(instrument);
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
    } else if (
      !session.capabilities.orderKinds.includes('market') ||
      (instrument.orderKinds !== undefined && !instrument.orderKinds.includes('market'))
    ) {
      availability = 'not-tradable';
      reason = 'Market orders are not available';
    }

    let quantityError: string | undefined;
    const quantity = this.#quantity;
    if (instrument) {
      const rules = instrument.quantity;
      if (quantity === undefined) quantityError = 'Enter a quantity';
      else {
        switch (checkQuantity(quantity, rules)) {
          case 'not-finite':
            quantityError = 'Enter a number';
            break;
          case 'not-positive':
            quantityError = 'Quantity must be positive';
            break;
          case 'below-min':
            quantityError = `Minimum is ${format.quantity(rules.min)}`;
            break;
          case 'above-max':
            quantityError = `Maximum is ${format.quantity(rules.max)}`;
            break;
          case 'off-step':
            quantityError = `Use steps of ${format.quantity(rules.step)}`;
            break;
        }
      }
    }

    const quote = this.#quote;
    const name = format.name || this.#instrumentId || '';
    const quantityText = quantity !== undefined && Number.isFinite(quantity) ? format.quantity(quantity) : '';
    const view = (side: Side): TradeSideView => {
      const price = side === 'buy' ? (quote?.ask ?? quote?.last) : (quote?.bid ?? quote?.last);
      let sideReason = reason ?? quantityError;
      if (!sideReason && price === undefined) sideReason = side === 'buy' ? 'No ask price' : 'No bid price';
      if (!sideReason && this.#busy) sideReason = 'Waiting for the broker';
      return {
        side,
        label: SIDE_LABELS[side],
        price,
        priceText: format.price(price),
        enabled: sideReason === undefined,
        reason: sideReason,
        description: [SIDE_LABELS[side], quantityText, name, 'at market'].filter(Boolean).join(' '),
      };
    };
    const buy = view('buy');
    const sell = view('sell');
    if (this.#armed && !(this.#armed === 'buy' ? buy : sell).enabled) this.#disarm();

    this.setState({
      availability,
      reason,
      instrumentId: this.#instrumentId,
      instrument,
      quote: toQuoteDisplay(quote, format),
      quantity,
      quantityError,
      confirm: this.#confirm,
      armed: this.#armed,
      busy: this.#busy,
      buy,
      sell,
      result: this.#result,
    });
  }
}
