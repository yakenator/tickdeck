import type { Bar, Instrument, InstrumentKind, QuoteSource, Unsubscribe } from '@tickdeck/core';

export interface FilterOption {
  id: string;
  label: string;
}

/** What the feed can serve. tickdeck hides features the feed cannot back. */
export interface FeedCapabilities {
  /** Timeframes offered to the user, e.g. `['1m', '5m', '1h', '1D']`. See `parseTimeframe`. */
  timeframes: readonly string[];
  /** Instrument kinds offered as search filters. */
  instrumentKinds?: readonly FilterOption[];
  /** Venues offered as search filters. */
  venues?: readonly FilterOption[];
  /** `findInstruments` is implemented. */
  search: boolean;
  /** `streamDepth` is implemented. */
  depth: boolean;
  /** `loadServerTime` is implemented. */
  serverTime: boolean;
}

export interface InstrumentQuery {
  /** Free text typed by the user. May be empty. */
  text: string;
  kind?: string;
  venue?: string;
  limit?: number;
  /** Number of results to skip, for paging. */
  offset?: number;
}

export interface InstrumentMatch {
  id: string;
  name: string;
  description?: string;
  kind: InstrumentKind;
  venue?: string;
}

export interface InstrumentOptions {
  /** Return the extended-hours session (pre and post market) instead of the regular one. */
  extendedHours?: boolean;
}

/** A page of history. Bars older than `to` are wanted, newest page first. */
export interface HistoryRequest {
  instrument: string;
  timeframe: string;
  /** Inclusive start, UTC epoch milliseconds. */
  from: number;
  /** Exclusive end, UTC epoch milliseconds. */
  to: number;
  /**
   * Minimum number of bars wanted before `to`. When set, return at least this
   * many bars if they exist, even if that means going back past `from`.
   */
  count?: number;
  /** True for the first page after the instrument or timeframe changed. */
  firstPage: boolean;
}

export interface HistoryPage {
  /** Bars in ascending time order, each with `time < to`. */
  bars: Bar[];
  /**
   * No bars exist before the oldest bar returned (or before `to` when `bars`
   * is empty). tickdeck stops asking for older pages.
   */
  endOfHistory?: boolean;
  /**
   * When `bars` is empty but older data exists further back (a long market
   * closure), the time of the newest older bar, so tickdeck can jump there.
   */
  olderBarTime?: number;
}

export interface BarStreamRequest {
  instrument: string;
  timeframe: string;
}

export interface BarStreamListener {
  /**
   * The newest bar changed. A bar with the same `time` as the previous one
   * replaces it, a later `time` starts a new bar.
   */
  onBar(bar: Bar): void;
  /**
   * Past bars changed (corrections, late data, adjustments). tickdeck drops
   * the history it cached for this stream and reloads it.
   */
  onHistoryChanged?(): void;
}

export interface DepthLevel {
  price: number;
  size: number;
}

/**
 * Order book update. A `snapshot` replaces the whole book; its levels are
 * best-first (bids descending, asks ascending). A `delta` lists only changed
 * levels, and a level with `size: 0` is removed.
 */
export interface DepthUpdate {
  instrument: string;
  kind: 'snapshot' | 'delta';
  bids: readonly DepthLevel[];
  asks: readonly DepthLevel[];
  time?: number;
}

export type DepthListener = (update: DepthUpdate) => void;

/**
 * The market data contract the integrator implements. tickdeck calls it and
 * never assumes where the data comes from.
 *
 * Conventions: requests return promises and reject with a `FeedError`;
 * streams take listeners and return an `Unsubscribe` function; listeners are
 * always called asynchronously, never from inside the subscribing call. Times
 * are UTC epoch milliseconds.
 */
export interface MarketFeed extends QuoteSource {
  getCapabilities(): Promise<FeedCapabilities>;
  /** Text search over instruments. */
  findInstruments(query: InstrumentQuery): Promise<InstrumentMatch[]>;
  /** Resolves an instrument id (or an alias the feed accepts) to its metadata. Rejects with code `not-found`. */
  getInstrument(id: string, options?: InstrumentOptions): Promise<Instrument>;
  /** Historical bars for one page. See {@link HistoryRequest} and {@link HistoryPage}. */
  loadHistory(request: HistoryRequest): Promise<HistoryPage>;
  /** Live updates of the newest bar. */
  streamBars(request: BarStreamRequest, listener: BarStreamListener): Unsubscribe;
  /** Order book stream: one snapshot first, then deltas or further snapshots. */
  streamDepth?(instrument: string, onDepth: DepthListener): Unsubscribe;
  /** The server's clock, used to align the time axis. */
  loadServerTime?(): Promise<number>;
}

export type FeedErrorCode = 'not-found' | 'unsupported' | 'invalid-request' | 'network' | 'bad-response';

export class FeedError extends Error {
  override readonly name = 'FeedError';
  readonly code: FeedErrorCode;

  constructor(code: FeedErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}
