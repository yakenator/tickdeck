import {
  microtask,
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
  type DepthLevel,
  type DepthListener,
  type FeedCapabilities,
  type HistoryPage,
  type HistoryRequest,
  type InstrumentMatch,
  type InstrumentOptions,
  type InstrumentQuery,
  type MarketFeed,
} from '../contract';
import { diffDepth, type DepthSides } from '../depth-book';
import { parseTimeframe, timeframeDuration } from '../timeframe';

/** The subset of the WHATWG `fetch` API the adapter uses. */
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; statusText?: string; json(): Promise<unknown> }>;

export type HttpEndpoint = 'capabilities' | 'search' | 'instrument' | 'history' | 'quotes' | 'depth' | 'time';

/** A history page as decoded from the server, with an optional data revision. */
export interface HttpHistoryPage extends HistoryPage {
  /**
   * Changes whenever past bars were corrected. When a poll sees a new value,
   * bar streams report `onHistoryChanged`.
   */
  revision?: string | number;
}

/** Turn server JSON into tickdeck types. Replace any of them to adapt another API shape. */
export interface HttpFeedDecoders {
  capabilities(json: unknown): FeedCapabilities;
  search(json: unknown): InstrumentMatch[];
  instrument(json: unknown): Instrument;
  history(json: unknown, request: HistoryRequest): HttpHistoryPage;
  quotes(json: unknown): Quote[];
  depth(json: unknown): DepthSides;
  time(json: unknown): number;
}

export interface HttpPollingFeedOptions {
  /** Base URL, e.g. `https://example.com/api/feed`. Endpoint paths are appended to it. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Extra request headers, or a function returning them (for example to add a fresh token). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Path of each endpoint relative to `baseUrl`. Defaults to the endpoint name. */
  paths?: Partial<Record<HttpEndpoint, string>>;
  decode?: Partial<HttpFeedDecoders>;
  scheduler?: Scheduler;
  /** Poll period for bar streams. Default 5000. */
  barPollMs?: number;
  /** Poll period for focus instruments in quote streams. Default 1000. */
  focusQuotePollMs?: number;
  /** Poll period for the other instruments in quote streams. Default 30000. */
  quotePollMs?: number;
  /** Poll period for depth streams. Default 1000. */
  depthPollMs?: number;
  /** Levels per side requested from the depth endpoint. Default 20. */
  depthLevels?: number;
  /** Called when a background poll fails. Polling continues with the next period. */
  onError?: (error: FeedError, endpoint: HttpEndpoint) => void;
}

type Query = Record<string, string | number | boolean | undefined>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badResponse(endpoint: HttpEndpoint, detail: string): FeedError {
  return new FeedError('bad-response', `Unexpected ${endpoint} response: ${detail}`);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function decodeBar(value: unknown): Bar {
  if (!isObject(value)) throw badResponse('history', 'bar is not an object');
  const { time, open, high, low, close, volume } = value;
  if (![time, open, high, low, close].every(isFiniteNumber)) throw badResponse('history', 'bar fields must be numbers');
  const bar: Bar = {
    time: time as number,
    open: open as number,
    high: high as number,
    low: low as number,
    close: close as number,
  };
  if (isFiniteNumber(volume)) bar.volume = volume;
  return bar;
}

function decodeLevels(value: unknown): DepthLevel[] {
  if (!Array.isArray(value)) throw badResponse('depth', 'levels must be an array');
  return value.map((level) => {
    if (!isObject(level) || !isFiniteNumber(level.price) || !isFiniteNumber(level.size)) {
      throw badResponse('depth', 'level needs numeric price and size');
    }
    return { price: level.price, size: level.size };
  });
}

/** Decoders for the tickdeck JSON shapes documented in the package README. */
export const defaultHttpFeedDecoders: HttpFeedDecoders = {
  capabilities(json) {
    if (!isObject(json) || !Array.isArray(json.timeframes)) throw badResponse('capabilities', 'missing timeframes');
    return {
      timeframes: json.timeframes.map(String),
      instrumentKinds: Array.isArray(json.instrumentKinds) ? (json.instrumentKinds as FeedCapabilities['instrumentKinds']) : undefined,
      venues: Array.isArray(json.venues) ? (json.venues as FeedCapabilities['venues']) : undefined,
      search: json.search === true,
      depth: json.depth === true,
      serverTime: json.serverTime === true,
    };
  },
  search(json) {
    if (!Array.isArray(json)) throw badResponse('search', 'expected an array');
    return json.filter((item): item is InstrumentMatch => isObject(item) && typeof item.id === 'string');
  },
  instrument(json) {
    if (!isObject(json) || typeof json.id !== 'string' || !isFiniteNumber(json.tickSize) || !isObject(json.quantity)) {
      throw badResponse('instrument', 'missing id, tickSize or quantity');
    }
    return json as unknown as Instrument;
  },
  history(json, request) {
    if (!isObject(json) || !Array.isArray(json.bars)) throw badResponse('history', 'missing bars');
    const bars = json.bars
      .map(decodeBar)
      .filter((bar) => bar.time < request.to)
      .sort((a, b) => a.time - b.time)
      .filter((bar, index, all) => index === 0 || bar.time !== all[index - 1]?.time);
    const page: HttpHistoryPage = { bars };
    if (json.endOfHistory === true) page.endOfHistory = true;
    if (isFiniteNumber(json.olderBarTime)) page.olderBarTime = json.olderBarTime;
    if (typeof json.revision === 'string' || isFiniteNumber(json.revision)) page.revision = json.revision;
    return page;
  },
  quotes(json) {
    if (!Array.isArray(json)) throw badResponse('quotes', 'expected an array');
    return json.filter((item): item is Quote => isObject(item) && typeof item.instrument === 'string');
  },
  depth(json) {
    if (!isObject(json)) throw badResponse('depth', 'expected an object');
    const bids = decodeLevels(json.bids).sort((a, b) => b.price - a.price);
    const asks = decodeLevels(json.asks).sort((a, b) => a.price - b.price);
    return { bids, asks };
  },
  time(json) {
    const time = isObject(json) ? json.time : json;
    if (!isFiniteNumber(time)) throw badResponse('time', 'expected a number');
    return time;
  },
};

/**
 * `MarketFeed` over a small JSON-over-HTTP API, with polling for realtime
 * data. Every endpoint path and response decoder can be replaced, so it can
 * front most REST market data services.
 *
 * Streams poll in the background: bars every `barPollMs`, focus quotes every
 * `focusQuotePollMs`, other quotes every `quotePollMs`, depth every
 * `depthPollMs`. Polls of one stream never overlap.
 */
export class HttpPollingFeed implements MarketFeed {
  readonly #options: HttpPollingFeedOptions;
  readonly #decode: HttpFeedDecoders;
  readonly #scheduler: Scheduler;

  constructor(options: HttpPollingFeedOptions) {
    this.#options = options;
    this.#decode = { ...defaultHttpFeedDecoders, ...options.decode };
    this.#scheduler = options.scheduler ?? systemScheduler;
  }

  async getCapabilities(): Promise<FeedCapabilities> {
    return this.#decode.capabilities(await this.#get('capabilities', {}));
  }

  async findInstruments(query: InstrumentQuery): Promise<InstrumentMatch[]> {
    const json = await this.#get('search', {
      text: query.text,
      kind: query.kind,
      venue: query.venue,
      limit: query.limit,
      offset: query.offset,
    });
    return this.#decode.search(json);
  }

  async getInstrument(id: string, options: InstrumentOptions = {}): Promise<Instrument> {
    const json = await this.#get('instrument', { id, extendedHours: options.extendedHours || undefined });
    return this.#decode.instrument(json);
  }

  async loadHistory(request: HistoryRequest): Promise<HistoryPage> {
    const { revision: _revision, ...page } = await this.#history(request);
    return page;
  }

  async loadQuotes(instruments: readonly string[]): Promise<Quote[]> {
    if (instruments.length === 0) return [];
    return this.#decode.quotes(await this.#get('quotes', { instruments: instruments.join(',') }));
  }

  async loadServerTime(): Promise<number> {
    return this.#decode.time(await this.#get('time', {}));
  }

  streamBars(request: BarStreamRequest, listener: BarStreamListener): Unsubscribe {
    const timeframe = parseTimeframe(request.timeframe);
    const length = timeframeDuration(timeframe) ?? 86_400_000;
    let last: Bar | undefined;
    let revision: string | number | undefined;
    return this.#poll('history', this.#options.barPollMs ?? 5_000, async (isActive) => {
      const now = this.#scheduler.now();
      const page = await this.#history({
        instrument: request.instrument,
        timeframe: request.timeframe,
        from: last?.time ?? now - 2 * length,
        to: now + length,
        count: last ? undefined : 1,
        firstPage: false,
      });
      if (!isActive()) return;
      if (page.revision !== undefined) {
        const changed = revision !== undefined && page.revision !== revision;
        revision = page.revision;
        if (changed) listener.onHistoryChanged?.();
      }
      for (const bar of page.bars) {
        if (last && (bar.time < last.time || sameBar(bar, last))) continue;
        last = bar;
        listener.onBar({ ...bar });
      }
    });
  }

  streamQuotes(request: QuoteStreamRequest, onQuotes: QuoteListener): Unsubscribe {
    const focus = [...new Set(request.focus ?? [])];
    const others = [...new Set(request.instruments)].filter((id) => !focus.includes(id));
    const sent = new Map<string, string>();
    const pollGroup = (instruments: string[], intervalMs: number): Unsubscribe => {
      if (instruments.length === 0) return () => {};
      return this.#poll('quotes', intervalMs, async (isActive) => {
        const quotes = await this.loadQuotes(instruments);
        if (!isActive()) return;
        const changed = quotes.filter((quote) => {
          const signature = JSON.stringify(quote);
          if (sent.get(quote.instrument) === signature) return false;
          sent.set(quote.instrument, signature);
          return true;
        });
        if (changed.length > 0) onQuotes(changed);
      });
    };
    const stopFocus = pollGroup(focus, this.#options.focusQuotePollMs ?? 1_000);
    const stopOthers = pollGroup(others, this.#options.quotePollMs ?? 30_000);
    return () => {
      stopFocus();
      stopOthers();
    };
  }

  streamDepth(instrument: string, onDepth: DepthListener): Unsubscribe {
    let book: DepthSides | undefined;
    return this.#poll('depth', this.#options.depthPollMs ?? 1_000, async (isActive) => {
      const json = await this.#get('depth', { instrument, levels: this.#options.depthLevels ?? 20 });
      if (!isActive()) return;
      const next = this.#decode.depth(json);
      const time = this.#scheduler.now();
      if (!book) {
        book = next;
        onDepth({ instrument, kind: 'snapshot', bids: next.bids, asks: next.asks, time });
        return;
      }
      const delta = diffDepth(book, next);
      book = next;
      if (delta.bids.length + delta.asks.length > 0) onDepth({ instrument, kind: 'delta', ...delta, time });
    });
  }

  async #history(request: HistoryRequest): Promise<HttpHistoryPage> {
    const json = await this.#get('history', {
      instrument: request.instrument,
      timeframe: request.timeframe,
      from: request.from,
      to: request.to,
      count: request.count,
      firstPage: request.firstPage,
    });
    return this.#decode.history(json, request);
  }

  #url(endpoint: HttpEndpoint, query: Query): string {
    const base = this.#options.baseUrl.replace(/\/+$/, '');
    const path = (this.#options.paths?.[endpoint] ?? endpoint).replace(/^\/+/, '');
    const params = Object.entries(query)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    return params.length > 0 ? `${base}/${path}?${params.join('&')}` : `${base}/${path}`;
  }

  async #get(endpoint: HttpEndpoint, query: Query): Promise<unknown> {
    const fetcher = this.#options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!fetcher) throw new FeedError('unsupported', 'No fetch implementation available');
    const extra = this.#options.headers;
    const headers = { accept: 'application/json', ...(typeof extra === 'function' ? await extra() : extra) };
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetcher(this.#url(endpoint, query), { method: 'GET', headers });
    } catch (cause) {
      throw new FeedError('network', `Request to ${endpoint} failed`, { cause });
    }
    if (!response.ok) {
      const code = response.status === 404 ? 'not-found' : response.status === 400 || response.status === 422 ? 'invalid-request' : 'network';
      throw new FeedError(code, `${endpoint} responded ${response.status} ${response.statusText ?? ''}`.trim());
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new FeedError('bad-response', `${endpoint} returned invalid JSON`, { cause });
    }
  }

  /** Runs `task` now (asynchronously) and then every `intervalMs` after the previous run finished. */
  #poll(endpoint: HttpEndpoint, intervalMs: number, task: (isActive: () => boolean) => Promise<void>): Unsubscribe {
    let active = true;
    let timer: TimerHandle | undefined;
    const isActive = () => active;
    const run = async () => {
      timer = undefined;
      if (!active) return;
      try {
        await task(isActive);
      } catch (error) {
        if (active) {
          const feedError = error instanceof FeedError ? error : new FeedError('bad-response', String(error), { cause: error });
          this.#options.onError?.(feedError, endpoint);
        }
      }
      if (active) timer = this.#scheduler.setTimeout(() => void run(), intervalMs);
    };
    microtask(() => void run());
    return () => {
      active = false;
      if (timer !== undefined) this.#scheduler.clearTimeout(timer);
    };
  }
}

function sameBar(a: Bar, b: Bar): boolean {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}
