import type { Unsubscribe } from './emitter';

/** Direction of an order, fill or position. */
export type Side = 'buy' | 'sell';

export function oppositeSide(side: Side): Side {
  return side === 'buy' ? 'sell' : 'buy';
}

/** `1` for buy (long), `-1` for sell (short). */
export function sideSign(side: Side): 1 | -1 {
  return side === 'buy' ? 1 : -1;
}

/**
 * How an order is priced.
 *
 * - `market`: executes at the best available price.
 * - `limit`: executes at `limitPrice` or better.
 * - `stop`: becomes a market order once the market reaches `stopPrice`.
 * - `stop-limit`: becomes a limit order at `limitPrice` once the market reaches `stopPrice`.
 */
export type OrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

/**
 * How long an order keeps working.
 *
 * - `day`: until the end of the trading day.
 * - `gtc`: until filled or cancelled.
 * - `gtd`: until a given time (`expiresAt`).
 * - `ioc`: fill what is possible immediately, cancel the rest.
 * - `fok`: fill the whole quantity immediately or cancel.
 */
export type TimeInForce = 'day' | 'gtc' | 'gtd' | 'ioc' | 'fok';

/** One price bar. `time` is the bar's open time in UTC epoch milliseconds. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type InstrumentKind =
  | 'stock'
  | 'fund'
  | 'index'
  | 'futures'
  | 'option'
  | 'forex'
  | 'crypto'
  | 'bond'
  | 'commodity'
  | 'cfd'
  | (string & {});

/**
 * Allowed order quantities. A valid quantity is at least `min`, at most `max`
 * and a whole number of `step`s above `min`.
 */
export interface QuantityRules {
  min: number;
  max?: number;
  step: number;
}

/** Instrument metadata shared by the data feed, the broker and the widgets. */
export interface Instrument {
  /** Canonical id used in every feed and broker call, e.g. `XNAS:AAPL`. */
  id: string;
  /** Short display name, e.g. `AAPL`. */
  name: string;
  description?: string;
  kind: InstrumentKind;
  /** Exchange or venue code. */
  venue?: string;
  /** Currency prices are quoted in. */
  currency?: string;
  /** IANA timezone of the venue, e.g. `America/New_York`. Sessions are expressed in it. */
  timezone: string;
  /** Trading hours in tickdeck session syntax (see `parseSession`), e.g. `Mon-Fri 09:30-16:00` or `always`. */
  session: string;
  /** Smallest price increment. Prices are rounded to multiples of it. */
  tickSize: number;
  /** Decimal places used to display prices. */
  pricePrecision: number;
  quantity: QuantityRules;
  /** Value, in `currency`, of a 1.0 price move for one unit of quantity. Defaults to 1. */
  pointValue?: number;
  /** Timeframes available for this instrument, when narrower than the feed's list. */
  timeframes?: readonly string[];
}

/** Latest market snapshot for one instrument. Fields the source does not know are left out. */
export interface Quote {
  instrument: string;
  /** Time of the snapshot, UTC epoch milliseconds. */
  time?: number;
  last?: number;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  /** Open, high and low of the current trading day. */
  open?: number;
  high?: number;
  low?: number;
  /** Close of the previous trading day. */
  prevClose?: number;
  /** `last - prevClose`. */
  change?: number;
  /** `change` as a percentage of `prevClose`. */
  changePercent?: number;
  /** Volume of the current trading day. */
  volume?: number;
}

export interface QuoteStreamRequest {
  /** Instruments to watch. Updates may arrive at a relaxed pace (about once a minute is acceptable). */
  instruments: readonly string[];
  /**
   * Instruments the user is actively trading or looking at closely (order
   * ticket, trade buttons, positions). Push these as soon as they change.
   */
  focus?: readonly string[];
}

export type QuoteListener = (quotes: readonly Quote[]) => void;

/**
 * Source of quotes. The data feed implements it, and the mock broker
 * consumes it to simulate fills.
 */
export interface QuoteSource {
  /** One-off snapshot. Unknown instruments are left out of the result. */
  loadQuotes(instruments: readonly string[]): Promise<Quote[]>;
  /**
   * Streams quotes until the returned function is called. Each quote carries
   * every field known for its instrument, not only the changed ones. The
   * listener is always called asynchronously, never from inside this call.
   */
  streamQuotes(request: QuoteStreamRequest, onQuotes: QuoteListener): Unsubscribe;
}
