import type { BrokerSession, TradingRules } from '@tickdeck/broker';
import {
  decimalPlaces,
  type Instrument,
  type OrderKind,
  type QuantityRules,
  type TimeInForce,
} from '@tickdeck/core';
import type { WidgetContext, WidgetFeed } from './context';
import { formatAmount, moneyPrecision } from './format';

/**
 * An instrument as the widgets see it: the broker's trading rules for the
 * active account, completed with the feed's metadata (name, precision).
 */
export interface TradableInstrument {
  id: string;
  /** Short display name, from the feed when it knows the instrument, else the id. */
  name: string;
  description?: string;
  tradable: boolean;
  /** Why the instrument cannot be traded. */
  reason?: string;
  tickSize: number;
  /** Decimal places for prices. */
  pricePrecision: number;
  quantity: QuantityRules;
  /** Decimal places for quantities, from the quantity step and minimum. */
  quantityPrecision: number;
  /** Value of a 1.0 price move for one unit of quantity. */
  pointValue: number;
  currency: string;
  /** Decimal places for money amounts in `currency`. */
  moneyPrecision: number;
  /** Order kinds allowed for this instrument, when narrower than the broker's. */
  orderKinds?: readonly OrderKind[];
  timeInForce?: readonly TimeInForce[];
  marginRate?: number;
}

/** Builds a `TradableInstrument` from broker rules and optional feed metadata. */
export function toTradableInstrument(
  rules: TradingRules,
  instrument: Instrument | undefined,
  fallbackCurrency = 'USD',
): TradableInstrument {
  const currency = rules.currency ?? instrument?.currency ?? fallbackCurrency;
  return {
    id: rules.instrument,
    name: instrument?.name ?? rules.instrument,
    description: instrument?.description,
    tradable: rules.tradable,
    reason: rules.reason,
    tickSize: rules.tickSize,
    pricePrecision: rules.pricePrecision ?? instrument?.pricePrecision ?? decimalPlaces(rules.tickSize),
    quantity: rules.quantity,
    quantityPrecision: Math.max(decimalPlaces(rules.quantity.step), decimalPlaces(rules.quantity.min)),
    pointValue: rules.pointValue ?? instrument?.pointValue ?? 1,
    currency,
    moneyPrecision: moneyPrecision(currency),
    orderKinds: rules.orderKinds,
    timeInForce: rules.timeInForce,
    marginRate: rules.marginRate,
  };
}

/** Formats prices and quantities of one instrument, or plainly when it is not known yet. */
export class InstrumentFormat {
  readonly instrument: TradableInstrument | undefined;

  constructor(instrument: TradableInstrument | undefined) {
    this.instrument = instrument;
  }

  get name(): string {
    return this.instrument?.name ?? '';
  }

  price(value: number | undefined): string {
    if (value === undefined) return '';
    return this.instrument ? formatAmount(value, this.instrument.pricePrecision) : String(value);
  }

  /** Quantities are never rounded: extra decimals beyond the step's are kept. */
  quantity(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return '';
    return this.instrument
      ? formatAmount(value, Math.max(this.instrument.quantityPrecision, Math.min(decimalPlaces(value), 12)))
      : String(value);
  }

  money(value: number | undefined, signed = false): string {
    return formatAmount(value, this.instrument?.moneyPrecision ?? 2, { signed });
  }
}

/**
 * Resolves and caches `TradableInstrument`s for one session. Widgets on the
 * same session share one resolver (see `getInstrumentResolver`), so rules and
 * metadata are fetched once. The cache is dropped when the account changes.
 */
export class InstrumentResolver {
  readonly #session: BrokerSession;
  #feed: WidgetFeed | undefined;
  readonly #pending = new Map<string, Promise<TradableInstrument>>();
  readonly #resolved = new Map<string, TradableInstrument>();
  #generation = 0;

  constructor(session: BrokerSession, feed?: WidgetFeed) {
    this.#session = session;
    this.#feed = feed;
    session.on('account', () => this.clear());
  }

  /** Adds a feed for names and precision when the resolver was created without one. */
  useFeed(feed: WidgetFeed | undefined): void {
    if (feed && !this.#feed?.getInstrument && feed.getInstrument) {
      this.#feed = feed;
      this.clear();
    }
  }

  /** The instrument if it was already resolved. */
  peek(id: string): TradableInstrument | undefined {
    return this.#resolved.get(id);
  }

  get(id: string): Promise<TradableInstrument> {
    let pending = this.#pending.get(id);
    if (!pending) {
      const generation = this.#generation;
      pending = this.#load(id).then((instrument) => {
        if (generation === this.#generation) this.#resolved.set(id, instrument);
        return instrument;
      });
      pending.catch(() => {
        if (this.#pending.get(id) === pending) this.#pending.delete(id);
      });
      this.#pending.set(id, pending);
    }
    return pending;
  }

  clear(): void {
    this.#generation++;
    this.#pending.clear();
    this.#resolved.clear();
  }

  async #load(id: string): Promise<TradableInstrument> {
    const feed = this.#feed;
    const [rules, instrument] = await Promise.all([
      this.#session.getTradingRules(id),
      feed?.getInstrument ? feed.getInstrument(id).catch(() => undefined) : undefined,
    ]);
    const session = this.#session;
    const account = session.accounts.find((candidate) => candidate.id === session.activeAccountId.value);
    return toTradableInstrument(rules, instrument, session.balance.value?.currency ?? account?.currency);
  }
}

const resolvers = new WeakMap<BrokerSession, InstrumentResolver>();

/** The resolver shared by every widget on `context.session`. */
export function getInstrumentResolver(context: WidgetContext): InstrumentResolver {
  let resolver = resolvers.get(context.session);
  if (!resolver) {
    resolver = new InstrumentResolver(context.session, context.feed);
    resolvers.set(context.session, resolver);
  } else {
    resolver.useFeed(context.feed);
  }
  return resolver;
}
