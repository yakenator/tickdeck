import {
  addExact,
  divideExact,
  microtask,
  multiplyExact,
  roundToStep,
  roundToTick,
  subtractExact,
  systemScheduler,
  type Bar,
  type Instrument,
  type Quote,
  type QuoteListener,
  type QuoteStreamRequest,
  type Scheduler,
  type TimerHandle,
  type Unsubscribe,
} from '@tickdeck/core';
import {
  FeedError,
  type BarStreamListener,
  type BarStreamRequest,
  type DepthListener,
  type FeedCapabilities,
  type HistoryPage,
  type HistoryRequest,
  type InstrumentMatch,
  type InstrumentQuery,
  type MarketFeed,
} from '../contract';
import { diffDepth, type DepthSides } from '../depth-book';
import { barOpenTime, nextBarOpenTime, tryParseTimeframe, type Timeframe } from '../timeframe';
import { DAY, PriceModel, SECOND, mergeSegment, type Segment } from './price-model';
import { hash32, hashText, unitFloat } from './random';

export interface MockInstrument {
  instrument: Instrument;
  /** Price at the start of history. */
  startPrice: number;
  /** Typical daily move as a fraction of price. Default 0.02. */
  volatility?: number;
  /** Bid-ask spread in ticks. Default 2. */
  spreadTicks?: number;
  /** Average traded quantity per minute. Default 100. */
  baseVolume?: number;
}

export interface MockFeedOptions {
  /** Seed of the price paths. The same seed always produces the same data. Default 1. */
  seed?: number;
  instruments?: readonly MockInstrument[];
  /** First moment with data (rounded down to UTC midnight). Default 2024-01-01. */
  historyStart?: number;
  /** Clock and timers. Default: the host's. */
  scheduler?: Scheduler;
  /** Advance prices on a timer while something is subscribed. Default true. When false, call `tick` or `setQuote`. */
  autoTick?: boolean;
  /** Timer period for realtime updates. Default 1000. */
  tickIntervalMs?: number;
  /** How often non-focus instruments in a quote stream are refreshed. Default 5000. */
  relaxedQuoteIntervalMs?: number;
  /** Price levels per side in depth streams. Default 10. */
  depthLevels?: number;
  /** Most bars returned by one `loadHistory` call. Default 10000. */
  maxBarsPerPage?: number;
}

/** A quote set by hand through `MockFeed#setQuote`. */
export interface ManualQuote {
  bid: number;
  ask: number;
  /** Last trade price. Defaults to the mid price rounded to the tick. */
  last?: number;
  /** Quantity traded at `last`. Default 0. */
  volume?: number;
}

export const MOCK_TIMEFRAMES: readonly string[] = [
  '10t',
  '100t',
  '1s',
  '5s',
  '15s',
  '30s',
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '1D',
  '1W',
  '1M',
];

const simulated = (
  id: string,
  name: string,
  description: string,
  kind: Instrument['kind'],
  tickSize: number,
  pricePrecision: number,
  quantity: Instrument['quantity'],
  extra: Partial<Instrument> = {},
): Instrument => ({
  id,
  name,
  description,
  kind,
  venue: 'MOCK',
  currency: 'USD',
  timezone: 'Etc/UTC',
  session: 'always',
  tickSize,
  pricePrecision,
  quantity,
  ...extra,
});

/** Instruments `MockFeed` serves when none are given. All trade around the clock. */
export const defaultMockInstruments: readonly MockInstrument[] = [
  {
    instrument: simulated('MOCK:ACME', 'ACME', 'Acme Corp (simulated stock)', 'stock', 0.01, 2, {
      min: 1,
      max: 100_000,
      step: 1,
    }),
    startPrice: 100,
    volatility: 0.02,
    baseVolume: 500,
  },
  {
    instrument: simulated('MOCK:BTCUSD', 'BTCUSD', 'Bitcoin / US dollar (simulated)', 'crypto', 0.5, 1, {
      min: 0.001,
      max: 100,
      step: 0.001,
    }),
    startPrice: 40_000,
    volatility: 0.035,
    baseVolume: 5,
  },
  {
    instrument: simulated('MOCK:EURUSD', 'EURUSD', 'Euro / US dollar (simulated)', 'forex', 0.00001, 5, {
      min: 1_000,
      max: 10_000_000,
      step: 1_000,
    }),
    startPrice: 1.08,
    volatility: 0.005,
    spreadTicks: 3,
    baseVolume: 2_000_000,
  },
  {
    instrument: simulated(
      'MOCK:ES',
      'ES',
      'Equity index future (simulated)',
      'futures',
      0.25,
      2,
      { min: 1, max: 500, step: 1 },
      { pointValue: 50 },
    ),
    startPrice: 4_800,
    volatility: 0.012,
    spreadTicks: 1,
    baseVolume: 300,
  },
];

interface Entry {
  instrument: Instrument;
  spreadTicks: number;
  seed: number;
  model: PriceModel;
  live?: Live;
}

interface Live {
  /** Second-aligned time of the last update. */
  time: number;
  /** Scale applied to the model after manual quotes, so the path continues from them. */
  factor: number;
  last: number;
  bid: number;
  ask: number;
  dayStart: number;
  day: Segment;
  prevClose?: number;
}

interface BarStream {
  entry: Entry;
  timeframe: Timeframe;
  listener: BarStreamListener;
  bar?: Segment & { time: number };
  /** Data up to this second is merged into `bar`. */
  until: number;
  nextOpen: number;
  active: boolean;
}

interface QuoteStream {
  focus: Set<string>;
  relaxed: Set<string>;
  listener: QuoteListener;
  lastRelaxedAt: number;
  sent: Map<string, string>;
  active: boolean;
}

interface DepthStream {
  entry: Entry;
  listener: DepthListener;
  book?: DepthSides;
  active: boolean;
}

const floorSecond = (time: number) => Math.floor(time / SECOND) * SECOND;

function scaled(segment: Segment, factor: number): Segment {
  if (factor === 1) return segment;
  return {
    open: segment.open * factor,
    high: segment.high * factor,
    low: segment.low * factor,
    close: segment.close * factor,
    volume: segment.volume,
  };
}

function includes(text: string | undefined, needle: string): boolean {
  return text !== undefined && text.toLowerCase().includes(needle);
}

/**
 * Deterministic in-memory `MarketFeed` for development, demos and tests.
 *
 * Prices follow a seeded random walk: the same seed, instruments and
 * `historyStart` always give the same bars, at any timeframe. Realtime bars,
 * quotes and depth continue the same path as time passes, either on a timer
 * (`autoTick`) or when `tick` is called. `setQuote` forces a price; the path
 * then continues from it in realtime (history stays on the original path).
 */
export class MockFeed implements MarketFeed {
  readonly #entries = new Map<string, Entry>();
  readonly #scheduler: Scheduler;
  readonly #autoTick: boolean;
  readonly #tickIntervalMs: number;
  readonly #relaxedQuoteIntervalMs: number;
  readonly #depthLevels: number;
  readonly #maxBarsPerPage: number;
  readonly #origin: number;
  readonly #barStreams = new Set<BarStream>();
  readonly #quoteStreams = new Set<QuoteStream>();
  readonly #depthStreams = new Set<DepthStream>();
  #timer: TimerHandle | undefined;

  constructor(options: MockFeedOptions = {}) {
    const seed = options.seed ?? 1;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#autoTick = options.autoTick ?? true;
    this.#tickIntervalMs = options.tickIntervalMs ?? 1_000;
    this.#relaxedQuoteIntervalMs = options.relaxedQuoteIntervalMs ?? 5_000;
    this.#depthLevels = options.depthLevels ?? 10;
    this.#maxBarsPerPage = options.maxBarsPerPage ?? 10_000;
    this.#origin = Math.floor((options.historyStart ?? Date.UTC(2024, 0, 1)) / DAY) * DAY;
    for (const spec of options.instruments ?? defaultMockInstruments) {
      const instrumentSeed = hash32(seed, hashText(spec.instrument.id));
      this.#entries.set(spec.instrument.id, {
        instrument: spec.instrument,
        spreadTicks: spec.spreadTicks ?? 2,
        seed: instrumentSeed,
        model: new PriceModel({
          seed: instrumentSeed,
          origin: this.#origin,
          startPrice: spec.startPrice,
          volatility: spec.volatility ?? 0.02,
          baseVolume: spec.baseVolume ?? 100,
        }),
      });
    }
  }

  /** Instruments this feed serves. */
  get instruments(): Instrument[] {
    return [...this.#entries.values()].map((entry) => ({ ...entry.instrument }));
  }

  /** First moment with data (UTC midnight). */
  get historyStart(): number {
    return this.#origin;
  }

  async getCapabilities(): Promise<FeedCapabilities> {
    const kinds = [...new Set([...this.#entries.values()].map((entry) => entry.instrument.kind))];
    return {
      timeframes: MOCK_TIMEFRAMES,
      instrumentKinds: kinds.map((kind) => ({ id: kind, label: kind })),
      venues: [{ id: 'MOCK', label: 'Simulated' }],
      search: true,
      depth: true,
      serverTime: true,
    };
  }

  async findInstruments(query: InstrumentQuery): Promise<InstrumentMatch[]> {
    const text = query.text.trim().toLowerCase();
    const matches = [...this.#entries.values()]
      .map((entry) => entry.instrument)
      .filter(
        (instrument) =>
          (!text ||
            includes(instrument.id, text) ||
            includes(instrument.name, text) ||
            includes(instrument.description, text)) &&
          (!query.kind || instrument.kind === query.kind) &&
          (!query.venue || instrument.venue === query.venue),
      )
      .map(({ id, name, description, kind, venue }) => ({ id, name, description, kind, venue }));
    const offset = query.offset ?? 0;
    return matches.slice(offset, offset + (query.limit ?? 50));
  }

  async getInstrument(id: string): Promise<Instrument> {
    return { ...this.#require(id).instrument };
  }

  async loadServerTime(): Promise<number> {
    return this.#scheduler.now();
  }

  async loadHistory(request: HistoryRequest): Promise<HistoryPage> {
    const entry = this.#require(request.instrument);
    const timeframe = tryParseTimeframe(request.timeframe);
    if (!timeframe) throw new FeedError('invalid-request', `Invalid timeframe "${request.timeframe}"`);
    const now = floorSecond(this.#scheduler.now());
    const count = request.count ?? 0;
    const opens: number[] = [];
    let open = this.#barOpen(timeframe, Math.min(request.to - 1, now));
    while (open >= this.#origin && (open >= request.from || opens.length < count)) {
      if (opens.length >= this.#maxBarsPerPage) break;
      opens.push(open);
      open = this.#previousOpen(timeframe, open);
    }
    const reachedOrigin = open < this.#origin;
    opens.reverse();
    const bars = opens.map((barOpen) => {
      const end = Math.min(this.#nextOpen(timeframe, barOpen), now);
      return this.#toBar(entry, barOpen, entry.model.aggregate(barOpen, end));
    });
    if (bars.length > 0) return { bars, endOfHistory: reachedOrigin };
    if (reachedOrigin) return { bars, endOfHistory: true };
    return { bars, olderBarTime: open };
  }

  streamBars(request: BarStreamRequest, listener: BarStreamListener): Unsubscribe {
    const entry = this.#entries.get(request.instrument);
    const timeframe = tryParseTimeframe(request.timeframe);
    if (!entry || !timeframe) return () => {};
    const stream: BarStream = { entry, timeframe, listener, until: 0, nextOpen: 0, active: true };
    this.#barStreams.add(stream);
    this.#ensureTimer();
    microtask(() => {
      if (!stream.active) return;
      const now = floorSecond(this.#scheduler.now());
      const open = this.#barOpen(timeframe, now);
      if (open < this.#origin) return;
      const factor = entry.live?.factor ?? 1;
      stream.bar = { time: open, ...scaled(entry.model.aggregate(open, now), factor) };
      stream.until = now;
      stream.nextOpen = this.#nextOpen(timeframe, open);
      listener.onBar(this.#toBar(entry, open, stream.bar));
    });
    return () => this.#remove(this.#barStreams, stream);
  }

  async loadQuotes(instruments: readonly string[]): Promise<Quote[]> {
    const now = floorSecond(this.#scheduler.now());
    const quotes: Quote[] = [];
    for (const id of instruments) {
      const entry = this.#entries.get(id);
      if (!entry) continue;
      if (this.#autoTick && !this.#isWatched(entry)) this.#advanceLive(entry, now);
      quotes.push(this.#quote(entry, now));
    }
    return quotes;
  }

  streamQuotes(request: QuoteStreamRequest, onQuotes: QuoteListener): Unsubscribe {
    const focus = new Set((request.focus ?? []).filter((id) => this.#entries.has(id)));
    const relaxed = new Set(request.instruments.filter((id) => this.#entries.has(id) && !focus.has(id)));
    const stream: QuoteStream = { focus, relaxed, listener: onQuotes, lastRelaxedAt: 0, sent: new Map(), active: true };
    this.#quoteStreams.add(stream);
    this.#ensureTimer();
    microtask(() => {
      if (!stream.active) return;
      const now = floorSecond(this.#scheduler.now());
      stream.lastRelaxedAt = now;
      const quotes = [...focus, ...relaxed].map((id) => this.#quote(this.#entries.get(id) as Entry, now));
      for (const quote of quotes) stream.sent.set(quote.instrument, this.#signature(quote));
      if (quotes.length > 0) onQuotes(quotes);
    });
    return () => this.#remove(this.#quoteStreams, stream);
  }

  streamDepth(instrument: string, onDepth: DepthListener): Unsubscribe {
    const entry = this.#entries.get(instrument);
    if (!entry) return () => {};
    const stream: DepthStream = { entry, listener: onDepth, active: true };
    this.#depthStreams.add(stream);
    this.#ensureTimer();
    microtask(() => {
      if (!stream.active) return;
      const now = floorSecond(this.#scheduler.now());
      this.#ensureLive(entry, now);
      stream.book = this.#book(entry, now);
      onDepth({ instrument, kind: 'snapshot', ...stream.book, time: now });
    });
    return () => this.#remove(this.#depthStreams, stream);
  }

  /**
   * Forces the current quote of an instrument and pushes it to every stream
   * that includes it. Resolves after the listeners ran.
   */
  async setQuote(instrument: string, quote: ManualQuote): Promise<void> {
    const entry = this.#require(instrument);
    if (!(quote.bid > 0) || !(quote.ask >= quote.bid)) {
      throw new FeedError('invalid-request', `Bid ${quote.bid} and ask ${quote.ask} do not form a valid quote`);
    }
    await new Promise<void>((resolve) => {
      microtask(() => {
        this.#step(this.#scheduler.now(), { entry, quote });
        resolve();
      });
    });
  }

  /** Advances every subscribed instrument to the current time and pushes the changes. */
  tick(): Promise<void> {
    return new Promise((resolve) => {
      microtask(() => {
        this.#step(this.#scheduler.now());
        resolve();
      });
    });
  }

  /** Stops the timer and drops every subscription. */
  dispose(): void {
    for (const streams of [this.#barStreams, this.#quoteStreams, this.#depthStreams] as Set<{ active: boolean }>[]) {
      for (const stream of streams) stream.active = false;
      streams.clear();
    }
    this.#stopTimer();
  }

  #require(id: string): Entry {
    const entry = this.#entries.get(id) ?? [...this.#entries.values()].find((e) => e.instrument.name === id);
    if (!entry) throw new FeedError('not-found', `Unknown instrument "${id}"`);
    return entry;
  }

  #remove<T extends { active: boolean }>(streams: Set<T>, stream: T): void {
    stream.active = false;
    streams.delete(stream);
    if (this.#barStreams.size + this.#quoteStreams.size + this.#depthStreams.size === 0) this.#stopTimer();
  }

  #ensureTimer(): void {
    if (!this.#autoTick || this.#timer !== undefined) return;
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = undefined;
      this.#step(this.#scheduler.now());
      this.#ensureTimer();
    }, this.#tickIntervalMs);
  }

  #stopTimer(): void {
    if (this.#timer === undefined) return;
    this.#scheduler.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #barOpen(timeframe: Timeframe, time: number): number {
    if (timeframe.unit !== 'tick') return barOpenTime(time, timeframe);
    // One simulated trade per second, so N-tick bars span N seconds.
    const length = timeframe.count * SECOND;
    return Math.floor((time - this.#origin) / length) * length + this.#origin;
  }

  #nextOpen(timeframe: Timeframe, open: number): number {
    return timeframe.unit === 'tick' ? open + timeframe.count * SECOND : nextBarOpenTime(open, timeframe);
  }

  #previousOpen(timeframe: Timeframe, open: number): number {
    return this.#barOpen(timeframe, open - 1);
  }

  #round(entry: Entry, price: number): number {
    return roundToTick(price, entry.instrument.tickSize);
  }

  #toBar(entry: Entry, time: number, segment: Segment): Bar {
    return {
      time,
      open: this.#round(entry, segment.open),
      high: this.#round(entry, segment.high),
      low: this.#round(entry, segment.low),
      close: this.#round(entry, segment.close),
      volume: segment.volume,
    };
  }

  #isWatched(entry: Entry): boolean {
    for (const stream of this.#barStreams) if (stream.entry === entry) return true;
    for (const stream of this.#depthStreams) if (stream.entry === entry) return true;
    for (const stream of this.#quoteStreams) {
      if (stream.focus.has(entry.instrument.id) || stream.relaxed.has(entry.instrument.id)) return true;
    }
    return false;
  }

  #setPrice(entry: Entry, live: Live, price: number): void {
    const tick = entry.instrument.tickSize;
    const spread = multiplyExact(entry.spreadTicks, tick);
    live.bid = roundToTick(price - spread / 2, tick, 'down');
    live.ask = addExact(live.bid, spread);
    live.last = Math.min(Math.max(this.#round(entry, price), live.bid), live.ask);
  }

  #ensureLive(entry: Entry, now: number): Live {
    if (entry.live) return entry.live;
    const time = Math.max(now, this.#origin);
    const dayStart = Math.max(Math.floor(time / DAY) * DAY, this.#origin);
    const day = entry.model.aggregate(dayStart, time);
    const live: Live = {
      time,
      factor: 1,
      last: 0,
      bid: 0,
      ask: 0,
      dayStart,
      day,
      prevClose: dayStart > this.#origin ? this.#round(entry, day.open) : undefined,
    };
    this.#setPrice(entry, live, day.close);
    entry.live = live;
    return live;
  }

  /** Moves an instrument's live state along the model path up to `now`. */
  #advanceLive(entry: Entry, now: number): void {
    const live = this.#ensureLive(entry, now);
    if (now <= live.time) return;
    const model = entry.model;
    if (now >= live.dayStart + DAY) {
      live.dayStart = Math.floor(now / DAY) * DAY;
      live.day = scaled(model.aggregate(live.dayStart, now), live.factor);
      live.prevClose = this.#round(entry, live.day.open);
    } else {
      mergeSegment(live.day, scaled(model.aggregate(live.time, now), live.factor));
    }
    live.time = now;
    this.#setPrice(entry, live, live.day.close);
  }

  #advanceBars(stream: BarStream, now: number): void {
    const { entry, timeframe, listener } = stream;
    const bar = stream.bar;
    if (!bar) return;
    const factor = entry.live?.factor ?? 1;
    let current = bar;
    while (stream.nextOpen <= now) {
      if (stream.until < stream.nextOpen) {
        mergeSegment(current, scaled(entry.model.aggregate(stream.until, stream.nextOpen), factor));
      }
      listener.onBar(this.#toBar(entry, current.time, current));
      const open = stream.nextOpen;
      const price = entry.model.priceAt(open) * factor;
      current = { time: open, open: price, high: price, low: price, close: price, volume: 0 };
      stream.until = open;
      stream.nextOpen = this.#nextOpen(timeframe, open);
    }
    if (stream.until < now) {
      mergeSegment(current, scaled(entry.model.aggregate(stream.until, now), factor));
      stream.until = now;
    }
    stream.bar = current;
    listener.onBar(this.#toBar(entry, current.time, current));
  }

  #applyManual(entry: Entry, quote: ManualQuote, now: number): void {
    const live = this.#ensureLive(entry, now);
    const tick = entry.instrument.tickSize;
    const mid = (quote.bid + quote.ask) / 2;
    live.bid = this.#round(entry, quote.bid);
    live.ask = this.#round(entry, quote.ask);
    live.last = this.#round(entry, quote.last ?? roundToTick(mid, tick));
    live.factor = mid / entry.model.priceAt(live.time);
    const volume = quote.volume ?? 0;
    const point: Segment = { open: live.last, high: live.last, low: live.last, close: live.last, volume };
    mergeSegment(live.day, point);
    for (const stream of this.#barStreams) {
      if (stream.entry !== entry || !stream.bar) continue;
      mergeSegment(stream.bar, point);
      stream.listener.onBar(this.#toBar(entry, stream.bar.time, stream.bar));
    }
  }

  #step(time: number, manual?: { entry: Entry; quote: ManualQuote }): void {
    const now = floorSecond(time);
    const touched = new Set<Entry>();
    for (const entry of this.#entries.values()) {
      if (!this.#isWatched(entry) && entry !== manual?.entry) continue;
      this.#advanceLive(entry, now);
      for (const stream of this.#barStreams) if (stream.entry === entry) this.#advanceBars(stream, now);
      touched.add(entry);
    }
    if (manual) this.#applyManual(manual.entry, manual.quote, now);

    for (const stream of [...this.#quoteStreams]) {
      if (!stream.active) continue;
      const relaxedDue = now - stream.lastRelaxedAt >= this.#relaxedQuoteIntervalMs;
      if (relaxedDue) stream.lastRelaxedAt = now;
      const quotes: Quote[] = [];
      for (const entry of touched) {
        const id = entry.instrument.id;
        const wanted = stream.focus.has(id) || (stream.relaxed.has(id) && (relaxedDue || entry === manual?.entry));
        const quote = wanted ? this.#quoteFor(stream, entry, now) : undefined;
        if (quote) quotes.push(quote);
      }
      if (quotes.length > 0) stream.listener(quotes);
    }

    for (const stream of [...this.#depthStreams]) {
      if (!stream.active || !stream.book || !touched.has(stream.entry)) continue;
      const book = this.#book(stream.entry, now);
      const delta = diffDepth(stream.book, book);
      stream.book = book;
      if (delta.bids.length + delta.asks.length === 0) continue;
      stream.listener({ instrument: stream.entry.instrument.id, kind: 'delta', ...delta, time: now });
    }
  }

  /** The quote for a stream, or `undefined` when it has not changed since the last one sent. */
  #quoteFor(stream: QuoteStream, entry: Entry, now: number): Quote | undefined {
    const quote = this.#quote(entry, now);
    const signature = this.#signature(quote);
    if (stream.sent.get(entry.instrument.id) === signature) return undefined;
    stream.sent.set(entry.instrument.id, signature);
    return quote;
  }

  #signature(quote: Quote): string {
    return `${quote.last}|${quote.bid}|${quote.ask}|${quote.volume}|${quote.high}|${quote.low}`;
  }

  #quote(entry: Entry, now: number): Quote {
    const live = this.#ensureLive(entry, now);
    const book = this.#book(entry, live.time);
    const quote: Quote = {
      instrument: entry.instrument.id,
      time: live.time,
      last: live.last,
      bid: live.bid,
      ask: live.ask,
      bidSize: book.bids[0]?.size,
      askSize: book.asks[0]?.size,
      open: this.#round(entry, live.day.open),
      high: Math.max(this.#round(entry, live.day.high), live.last),
      low: Math.min(this.#round(entry, live.day.low), live.last),
      volume: live.day.volume,
    };
    if (live.prevClose !== undefined) {
      quote.prevClose = live.prevClose;
      quote.change = subtractExact(live.last, live.prevClose);
      quote.changePercent = roundToStep(divideExact(quote.change * 100, live.prevClose), 0.01);
    }
    return quote;
  }

  #book(entry: Entry, time: number): DepthSides {
    const live = this.#ensureLive(entry, time);
    const { tickSize, quantity } = entry.instrument;
    const bucket = Math.floor(time / 5_000);
    const level = (side: number, index: number, price: number) => {
      const ticks = Math.round(price / tickSize);
      const units = 1 + Math.floor(unitFloat(hash32(entry.seed, 6, side, ticks, bucket)) * 40 * (1 + index / 4));
      return { price, size: multiplyExact(quantity.step, units) };
    };
    const bids = [];
    const asks = [];
    for (let i = 0; i < this.#depthLevels; i++) {
      const offset = multiplyExact(i, tickSize);
      bids.push(level(0, i, subtractExact(live.bid, offset)));
      asks.push(level(1, i, addExact(live.ask, offset)));
    }
    return { bids, asks };
  }
}
