import type { Bar, Quote } from '@tickdeck/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedError, type DepthUpdate } from '../contract';
import { HttpPollingFeed, type FetchLike } from './http-polling-feed';

const NOW = Date.UTC(2026, 9, 14, 12, 0, 30);
const BASE = 'https://data.example/feed/';

type Query = Record<string, string>;
type Handler = (query: Query) => unknown;

function parseUrl(url: string): { path: string; query: Query } {
  const [path = '', search = ''] = url.slice(BASE.length).split('?');
  const query: Query = {};
  for (const pair of search ? search.split('&') : []) {
    const [key = '', value = ''] = pair.split('=');
    query[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return { path, query };
}

/** A fake server: one handler per path, every call recorded. */
function fakeServer(handlers: Record<string, Handler>) {
  const calls: { path: string; query: Query; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const { path, query } = parseUrl(url);
    calls.push({ path, query, headers: init.headers });
    const handler = handlers[path];
    if (!handler) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    const body = handler(query);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, calls, count: (path: string) => calls.filter((call) => call.path === path).length };
}

const bar = (time: number, close: number): Bar => ({ time, open: 100, high: 101, low: 99, close, volume: 10 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HttpPollingFeed requests', () => {
  it('builds query URLs, sends headers and decodes history', async () => {
    const server = fakeServer({
      history: () => ({
        bars: [bar(3_000, 3), bar(1_000, 1), bar(2_000, 2), bar(2_000, 2), bar(9_000, 9)],
        endOfHistory: true,
        revision: 4,
      }),
    });
    const feed = new HttpPollingFeed({
      baseUrl: BASE,
      fetch: server.fetch,
      headers: async () => ({ authorization: 'Bearer t' }),
    });

    const page = await feed.loadHistory({
      instrument: 'XNAS:AAPL',
      timeframe: '1m',
      from: 0,
      to: 5_000,
      count: 300,
      firstPage: true,
    });

    expect(page).toEqual({ bars: [bar(1_000, 1), bar(2_000, 2), bar(3_000, 3)], endOfHistory: true });
    const [call] = server.calls;
    expect(call!.path).toBe('history');
    expect(call!.query).toEqual({
      instrument: 'XNAS:AAPL',
      timeframe: '1m',
      from: '0',
      to: '5000',
      count: '300',
      firstPage: 'true',
    });
    expect(call!.headers).toEqual({ accept: 'application/json', authorization: 'Bearer t' });
  });

  it('supports custom paths and decoders', async () => {
    const server = fakeServer({
      'v2/candles': () => ({ t: [60_000, 120_000], c: [10, 11] }),
      'v2/clock': () => ({ epochMs: 42 }),
    });
    const feed = new HttpPollingFeed({
      baseUrl: BASE,
      fetch: server.fetch,
      paths: { history: '/v2/candles', time: 'v2/clock' },
      decode: {
        history: (json) => {
          const { t, c } = json as { t: number[]; c: number[] };
          return { bars: t.map((time, i) => ({ time, open: c[i]!, high: c[i]!, low: c[i]!, close: c[i]! })) };
        },
        time: (json) => (json as { epochMs: number }).epochMs,
      },
    });

    const page = await feed.loadHistory({ instrument: 'X', timeframe: '1m', from: 0, to: NOW, firstPage: true });
    expect(page.bars.map((b) => b.close)).toEqual([10, 11]);
    expect(await feed.loadServerTime()).toBe(42);
  });

  it('maps failures to FeedError codes', async () => {
    const server = fakeServer({
      instrument: () => new Error('socket hang up'),
      history: () => ({ bars: [{ time: 'x' }] }),
      quotes: () => ({ not: 'an array' }),
    });
    const feed = new HttpPollingFeed({ baseUrl: BASE, fetch: server.fetch });

    await expect(feed.getCapabilities()).rejects.toMatchObject({ code: 'not-found' });
    await expect(feed.getInstrument('X')).rejects.toMatchObject({ code: 'network' });
    await expect(
      feed.loadHistory({ instrument: 'X', timeframe: '1m', from: 0, to: 1, firstPage: true }),
    ).rejects.toMatchObject({ code: 'bad-response' });
    await expect(feed.loadQuotes(['X'])).rejects.toBeInstanceOf(FeedError);
  });

  it('decodes capabilities, search and instruments', async () => {
    const instrument = {
      id: 'XNAS:AAPL',
      name: 'AAPL',
      kind: 'stock',
      timezone: 'America/New_York',
      session: 'Mon-Fri 09:30-16:00',
      tickSize: 0.01,
      pricePrecision: 2,
      quantity: { min: 1, step: 1 },
    };
    const server = fakeServer({
      capabilities: () => ({ timeframes: ['1m', '1D'], depth: true }),
      search: () => [{ id: 'XNAS:AAPL', name: 'AAPL', kind: 'stock' }, { junk: true }],
      instrument: () => instrument,
    });
    const feed = new HttpPollingFeed({ baseUrl: BASE, fetch: server.fetch });

    expect(await feed.getCapabilities()).toMatchObject({ timeframes: ['1m', '1D'], depth: true, search: false });
    expect(await feed.findInstruments({ text: 'aap', limit: 5 })).toEqual([{ id: 'XNAS:AAPL', name: 'AAPL', kind: 'stock' }]);
    expect(server.calls[1]!.query).toEqual({ text: 'aap', limit: '5' });
    expect(await feed.getInstrument('XNAS:AAPL', { extendedHours: true })).toEqual(instrument);
    expect(server.calls[2]!.query.extendedHours).toBe('true');
  });
});

describe('HttpPollingFeed streams', () => {
  it('polls bars, emits only changes and reports history revisions', async () => {
    let bars = [bar(NOW - 60_000, 1), bar(NOW, 2)];
    let revision = 1;
    const server = fakeServer({ history: () => ({ bars, revision }) });
    const feed = new HttpPollingFeed({ baseUrl: BASE, fetch: server.fetch, barPollMs: 1_000 });
    const seen: Bar[] = [];
    const onHistoryChanged = vi.fn();

    const off = feed.streamBars({ instrument: 'X', timeframe: '1m' }, { onBar: (b) => seen.push(b), onHistoryChanged });
    expect(server.count('history')).toBe(0);

    await vi.advanceTimersByTimeAsync(0);
    expect(seen.map((b) => b.close)).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toHaveLength(2);

    bars = [bar(NOW, 3), bar(NOW + 60_000, 4)];
    revision = 2;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.map((b) => b.close)).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledOnce();
    expect(Number(server.calls.at(-1)!.query.from)).toBe(NOW);

    off();
    const polls = server.count('history');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.count('history')).toBe(polls);
  });

  it('polls focus quotes quickly and the rest slowly', async () => {
    let price = 100;
    const server = fakeServer({
      quotes: (query) =>
        query
          .instruments!.split(',')
          .map((instrument): Quote => ({ instrument, last: price })),
    });
    const feed = new HttpPollingFeed({ baseUrl: BASE, fetch: server.fetch, focusQuotePollMs: 1_000, quotePollMs: 10_000 });
    const batches: Quote[][] = [];

    feed.streamQuotes({ instruments: ['A', 'B', 'C'], focus: ['A'] }, (quotes) => batches.push([...quotes]));
    await vi.advanceTimersByTimeAsync(0);
    expect(batches.flat().map((q) => q.instrument).sort()).toEqual(['A', 'B', 'C']);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(batches).toHaveLength(2);

    price = 101;
    await vi.advanceTimersByTimeAsync(10_000);
    const instrumentsPolled = server.calls.map((call) => call.query.instruments);
    expect(instrumentsPolled.filter((list) => list === 'A')).toHaveLength(14);
    expect(instrumentsPolled.filter((list) => list === 'B,C')).toHaveLength(2);
    expect(batches.slice(2).flat().map((q) => q.instrument).sort()).toEqual(['A', 'B', 'C']);
  });

  it('turns polled depth into a snapshot followed by deltas', async () => {
    let bids = [
      { price: 99.9, size: 5 },
      { price: 100, size: 3 },
    ];
    const server = fakeServer({ depth: () => ({ bids, asks: [{ price: 100.1, size: 2 }] }) });
    const feed = new HttpPollingFeed({ baseUrl: BASE, fetch: server.fetch, depthPollMs: 500, depthLevels: 2 });
    const updates: DepthUpdate[] = [];

    feed.streamDepth('X', (update) => updates.push(update));
    await vi.advanceTimersByTimeAsync(0);
    bids = [{ price: 100, size: 4 }];
    await vi.advanceTimersByTimeAsync(1_000);

    expect(server.calls[0]!.query.levels).toBe('2');
    expect(updates).toEqual([
      {
        instrument: 'X',
        kind: 'snapshot',
        bids: [
          { price: 100, size: 3 },
          { price: 99.9, size: 5 },
        ],
        asks: [{ price: 100.1, size: 2 }],
        time: NOW,
      },
      {
        instrument: 'X',
        kind: 'delta',
        bids: [
          { price: 100, size: 4 },
          { price: 99.9, size: 0 },
        ],
        asks: [],
        time: NOW + 500,
      },
    ]);
  });

  it('reports poll failures and keeps polling', async () => {
    let fail = true;
    const server = fakeServer({
      quotes: () => (fail ? new Error('offline') : [{ instrument: 'A', last: 1 }]),
    });
    const onError = vi.fn();
    const feed = new HttpPollingFeed({ baseUrl: BASE, fetch: server.fetch, focusQuotePollMs: 1_000, onError });
    const onQuotes = vi.fn();

    feed.streamQuotes({ instruments: [], focus: ['A'] }, onQuotes);
    await vi.advanceTimersByTimeAsync(0);
    fail = false;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'network' }), 'quotes');
    expect(onQuotes).toHaveBeenCalledWith([{ instrument: 'A', last: 1 }]);
  });
});
