import { isOnTick, type Bar, type Quote } from '@tickdeck/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedError, type DepthUpdate } from '../contract';
import { DepthBook } from '../depth-book';
import { barOpenTime } from '../timeframe';
import { MockFeed } from './mock-feed';

const NOW = Date.UTC(2026, 9, 14, 12, 0, 30);
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ACME = 'MOCK:ACME';

const history = (feed: MockFeed, timeframe: string, from: number, to: number, count?: number) =>
  feed.loadHistory({ instrument: ACME, timeframe, from, to, count, firstPage: true });

function expectWellFormed(bars: Bar[], tickSize: number) {
  for (const [index, bar] of bars.entries()) {
    if (index > 0) expect(bar.time).toBeGreaterThan(bars[index - 1]!.time);
    expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
    expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
    for (const price of [bar.open, bar.high, bar.low, bar.close]) expect(isOnTick(price, tickSize)).toBe(true);
    expect(Number.isInteger(bar.volume)).toBe(true);
  }
}

function combine(bars: Bar[]): Omit<Bar, 'time'> {
  return {
    open: bars[0]!.open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: bars.at(-1)!.close,
    volume: bars.reduce((sum, bar) => sum + (bar.volume ?? 0), 0),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MockFeed history', () => {
  it('is deterministic for a seed and differs between seeds', async () => {
    const from = NOW - 6 * HOUR;
    const a = await history(new MockFeed({ seed: 7 }), '5m', from, NOW);
    const b = await history(new MockFeed({ seed: 7 }), '5m', from, NOW);
    const c = await history(new MockFeed({ seed: 8 }), '5m', from, NOW);

    expect(a.bars).toHaveLength(72);
    expect(b).toEqual(a);
    expect(c.bars.map((bar) => bar.close)).not.toEqual(a.bars.map((bar) => bar.close));
  });

  it('returns ascending, well-formed bars inside the requested window', async () => {
    const feed = new MockFeed({ seed: 3 });
    const from = NOW - 2 * DAY;
    const to = NOW - DAY;
    const { bars, endOfHistory } = await history(feed, '15m', from, to);

    expect(bars).toHaveLength(96);
    expect(bars[0]!.time).toBe(Date.UTC(2026, 9, 12, 12, 15));
    expect(bars.every((bar) => bar.time >= from && bar.time < to)).toBe(true);
    expect(endOfHistory).toBe(false);
    expectWellFormed(bars, 0.01);
  });

  it('goes back past `from` to satisfy `count`', async () => {
    const feed = new MockFeed();
    const { bars } = await history(feed, '1h', NOW - HOUR, NOW, 50);

    expect(bars).toHaveLength(50);
    expect(bars.at(-1)!.time).toBe(barOpenTime(NOW, '1h'));
  });

  it('ends with the in-progress bar when `to` is in the future', async () => {
    const feed = new MockFeed();
    const { bars } = await history(feed, '1m', NOW - 10 * MINUTE, NOW + HOUR);

    expect(bars.at(-1)!.time).toBe(barOpenTime(NOW, '1m'));
    const quote = (await feed.loadQuotes([ACME]))[0]!;
    expect(quote.last).toBeCloseTo(bars.at(-1)!.close, 1);
  });

  it('signals the end of history at the configured start', async () => {
    const historyStart = Date.UTC(2026, 9, 1);
    const feed = new MockFeed({ historyStart });

    const before = await history(feed, '1D', Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 20));
    expect(before).toEqual({ bars: [], endOfHistory: true });

    const across = await history(feed, '1D', Date.UTC(2026, 8, 25), Date.UTC(2026, 9, 5));
    expect(across.bars.map((bar) => bar.time)).toEqual([0, 1, 2, 3].map((d) => historyStart + d * DAY));
    expect(across.endOfHistory).toBe(true);

    const more = await history(feed, '1D', Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 5), 10);
    expect(more.bars).toHaveLength(4);
    expect(more.endOfHistory).toBe(true);
  });

  it('agrees across timeframes from one minute upwards', async () => {
    const feed = new MockFeed({ seed: 11 });
    const hourStart = Date.UTC(2026, 9, 13, 9);
    const minutes = await history(feed, '1m', hourStart, hourStart + HOUR);
    const hours = await history(feed, '1h', hourStart, hourStart + HOUR);
    expect(minutes.bars).toHaveLength(60);
    expect(hours.bars[0]).toEqual({ time: hourStart, ...combine(minutes.bars) });

    const dayStart = Date.UTC(2026, 9, 12);
    const hourly = await history(feed, '1h', dayStart, dayStart + DAY);
    const daily = await history(feed, '1D', dayStart, dayStart + DAY);
    expect(daily.bars[0]).toEqual({ time: dayStart, ...combine(hourly.bars) });
  });

  it('serves calendar, second and tick timeframes', async () => {
    const feed = new MockFeed({ instruments: undefined });
    const weeks = await history(feed, '1W', Date.UTC(2026, 6, 1), NOW);
    expect(weeks.bars.every((bar) => new Date(bar.time).getUTCDay() === 1)).toBe(true);
    const months = await history(feed, '1M', Date.UTC(2025, 0, 1), NOW);
    expect(months.bars).toHaveLength(22);
    expect(months.bars.every((bar) => new Date(bar.time).getUTCDate() === 1)).toBe(true);
    const seconds = await history(feed, '5s', NOW - MINUTE, NOW);
    expect(seconds.bars).toHaveLength(12);
    const ticks = await history(feed, '10t', NOW - MINUTE, NOW);
    expect(ticks.bars.length).toBeGreaterThan(0);
    expectWellFormed(weeks.bars, 0.01);
    expectWellFormed(months.bars, 0.01);
    expectWellFormed(seconds.bars, 0.01);
  });

  it('rejects unknown instruments and invalid timeframes with FeedError', async () => {
    const feed = new MockFeed();
    await expect(feed.getInstrument('NOPE')).rejects.toMatchObject({ name: 'FeedError', code: 'not-found' });
    await expect(history(feed, '1x', 0, NOW)).rejects.toBeInstanceOf(FeedError);
  });
});

describe('MockFeed lookup', () => {
  it('searches and resolves instruments', async () => {
    const feed = new MockFeed();
    expect((await feed.findInstruments({ text: 'usd' })).map((match) => match.id)).toEqual([
      'MOCK:BTCUSD',
      'MOCK:EURUSD',
    ]);
    expect(await feed.findInstruments({ text: '', kind: 'futures' })).toHaveLength(1);
    expect((await feed.getInstrument('ACME')).id).toBe(ACME);
    expect((await feed.getCapabilities()).timeframes).toContain('1D');
  });
});

describe('MockFeed realtime', () => {
  it('never calls listeners synchronously', () => {
    const feed = new MockFeed();
    const onBar = vi.fn();
    const onQuotes = vi.fn();
    const onDepth = vi.fn();
    feed.streamBars({ instrument: ACME, timeframe: '1m' }, { onBar });
    feed.streamQuotes({ instruments: [ACME] }, onQuotes);
    feed.streamDepth(ACME, onDepth);

    expect(onBar).not.toHaveBeenCalled();
    expect(onQuotes).not.toHaveBeenCalled();
    expect(onDepth).not.toHaveBeenCalled();
    feed.dispose();
  });

  it('updates the newest bar, starts new bars on time and matches history afterwards', async () => {
    const feed = new MockFeed({ seed: 5 });
    const bars: Bar[] = [];
    const off = feed.streamBars({ instrument: ACME, timeframe: '1m' }, { onBar: (bar) => bars.push(bar) });

    await vi.advanceTimersByTimeAsync(0);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.time).toBe(barOpenTime(NOW, '1m'));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(bars.length).toBeGreaterThan(1);
    expect(new Set(bars.map((bar) => bar.time)).size).toBe(1);

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    off();
    const times = [...new Set(bars.map((bar) => bar.time))];
    expect(times).toEqual([0, 1, 2].map((n) => barOpenTime(NOW, '1m') + n * MINUTE));

    const completed = bars.filter((bar) => bar.time === times[1]).at(-1)!;
    const fromHistory = await history(feed, '1m', times[1]!, times[1]! + MINUTE);
    expect(completed).toEqual(fromHistory.bars[0]);
  });

  it('pushes focus quotes every tick and the rest at the relaxed pace', async () => {
    const feed = new MockFeed({ relaxedQuoteIntervalMs: 5_000 });
    const batches: Quote[][] = [];
    feed.streamQuotes({ instruments: [ACME, 'MOCK:EURUSD'], focus: ['MOCK:BTCUSD'] }, (quotes) =>
      batches.push([...quotes]),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(batches[0]!.map((quote) => quote.instrument).sort()).toEqual([ACME, 'MOCK:BTCUSD', 'MOCK:EURUSD']);

    await vi.advanceTimersByTimeAsync(10_000);
    const count = (id: string) => batches.slice(1).filter((batch) => batch.some((q) => q.instrument === id)).length;
    expect(count('MOCK:BTCUSD')).toBeGreaterThanOrEqual(8);
    expect(count(ACME)).toBe(2);
    const quote = batches.at(-1)!.find((q) => q.instrument === 'MOCK:BTCUSD')!;
    expect(quote.bid).toBeLessThan(quote.ask!);
    expect(quote.last).toBeGreaterThanOrEqual(quote.bid!);
    expect(quote.last).toBeLessThanOrEqual(quote.ask!);
    feed.dispose();
  });

  it('streams a depth snapshot followed by deltas that keep the book consistent', async () => {
    const feed = new MockFeed({ depthLevels: 5 });
    const updates: DepthUpdate[] = [];
    const book = new DepthBook();
    feed.streamDepth(ACME, (update) => {
      updates.push(update);
      book.apply(update);
    });

    await vi.advanceTimersByTimeAsync(10_000);
    feed.dispose();

    expect(updates[0]!.kind).toBe('snapshot');
    expect(updates[0]!.bids).toHaveLength(5);
    expect(updates.slice(1).every((update) => update.kind === 'delta')).toBe(true);
    expect(updates.length).toBeGreaterThan(1);
    const [quote] = await feed.loadQuotes([ACME]);
    expect(book.bids).toHaveLength(5);
    expect(book.bestBid!.price).toBe(quote!.bid);
    expect(book.bestAsk!.price).toBe(quote!.ask);
    expect(book.bestAsk!.size).toBe(quote!.askSize);
  });

  it('lets tests force quotes, and continues the path from them', async () => {
    const feed = new MockFeed({ autoTick: false });
    const quotes: Quote[] = [];
    const bars: Bar[] = [];
    feed.streamQuotes({ instruments: [], focus: [ACME] }, (batch) => quotes.push(...batch));
    feed.streamBars({ instrument: ACME, timeframe: '1m' }, { onBar: (bar) => bars.push(bar) });
    await vi.advanceTimersByTimeAsync(0);

    await feed.setQuote(ACME, { bid: 250, ask: 250.04, volume: 10 });

    expect(quotes.at(-1)).toMatchObject({ instrument: ACME, bid: 250, ask: 250.04, last: 250.02 });
    expect(bars.at(-1)!.close).toBe(250.02);
    expect(bars.at(-1)!.high).toBeGreaterThanOrEqual(250.02);

    const sent = quotes.length;
    vi.setSystemTime(NOW + 3_000);
    await feed.tick();
    expect(quotes.length).toBe(sent + 1);
    expect(quotes.at(-1)!.time).toBe(NOW + 3_000);
    expect(quotes.at(-1)!.last).toBeGreaterThan(245);
    expect(quotes.at(-1)!.last).toBeLessThan(255);

    await expect(feed.setQuote(ACME, { bid: 2, ask: 1 })).rejects.toBeInstanceOf(FeedError);
  });
});
