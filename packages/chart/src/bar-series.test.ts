import type { Bar } from '@tickdeck/core';
import { MockFeed, type BarStreamListener, type HistoryPage, type HistoryRequest, type MarketFeed } from '@tickdeck/datafeed';
import { describe, expect, it, vi } from 'vitest';
import { BarSeries, mergeBar, normalizePage, type BarSeriesChange } from './bar-series';
import { ManualClock, flush } from './test/dom';

const MINUTE = 60_000;
const ORIGIN = Date.UTC(2024, 0, 1);
const bar = (time: number, close = 100): Bar => ({ time, open: close, high: close, low: close, close });

/** A feed whose history and stream are scripted by the test. */
function scriptedFeed(pages: (request: HistoryRequest) => HistoryPage | Promise<HistoryPage>) {
  const listeners: BarStreamListener[] = [];
  const unsubscribe = vi.fn();
  const loadHistory = vi.fn(async (request: HistoryRequest) => pages(request));
  const feed = {
    loadHistory,
    streamBars: vi.fn((_request, listener: BarStreamListener) => {
      listeners.push(listener);
      return unsubscribe;
    }),
  } as unknown as MarketFeed;
  return { feed, loadHistory, listeners, unsubscribe };
}

function mockSetup(minutesOfHistory: number) {
  const clock = new ManualClock(ORIGIN + minutesOfHistory * MINUTE + 30_000);
  const feed = new MockFeed({ autoTick: false, scheduler: clock, historyStart: ORIGIN });
  return { clock, feed };
}

describe('mergeBar and normalizePage', () => {
  it('replaces the newest bar, appends later ones and ignores older ones', () => {
    const bars = [bar(0), bar(MINUTE)];
    expect(mergeBar(bars, bar(MINUTE, 101))).toBe('update');
    expect(mergeBar(bars, bar(2 * MINUTE, 102))).toBe('append');
    expect(mergeBar(bars, bar(0, 99))).toBe('ignore');
    expect(bars.map((b) => b.close)).toEqual([100, 101, 102]);
    const empty: Bar[] = [];
    expect(mergeBar(empty, bar(5))).toBe('append');
  });

  it('sorts pages, drops duplicates and bars at or after the end', () => {
    const page = normalizePage([bar(3 * MINUTE), bar(MINUTE), bar(MINUTE), bar(5 * MINUTE), bar(2 * MINUTE)], 5 * MINUTE);
    expect(page.map((b) => b.time)).toEqual([MINUTE, 2 * MINUTE, 3 * MINUTE]);
  });
});

describe('BarSeries with MockFeed', () => {
  it('loads the newest page first, with firstPage set once', async () => {
    const { clock, feed } = mockSetup(600);
    const spy = vi.spyOn(feed, 'loadHistory');
    const series = new BarSeries(feed, { instrument: 'MOCK:ACME', timeframe: '1m' }, { pageSize: 50, scheduler: clock });
    const changes: BarSeriesChange[] = [];
    series.on('change', (change) => changes.push(change));

    const bars = await series.loadInitial();

    expect(bars).toHaveLength(50);
    expect(bars.at(-1)?.time).toBe(ORIGIN + 600 * MINUTE);
    expect(bars.every((b, i) => i === 0 || b.time - (bars[i - 1] as Bar).time === MINUTE)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ instrument: 'MOCK:ACME', timeframe: '1m', count: 50, firstPage: true });
    expect(changes).toEqual([{ kind: 'reset', bars }]);
    expect(series.loaded).toBe(true);
    expect(series.endOfHistory).toBe(false);
    series.dispose();
  });

  it('pages older history in front until the end of history', async () => {
    const { clock, feed } = mockSetup(30);
    const spy = vi.spyOn(feed, 'loadHistory');
    const series = new BarSeries(feed, { instrument: 'MOCK:ACME', timeframe: '1m' }, { pageSize: 20, scheduler: clock });
    const changes: BarSeriesChange[] = [];
    series.on('change', (change) => changes.push(change));
    await series.loadInitial();
    const firstOldest = series.bars[0]?.time as number;

    const older = await series.loadOlder();

    expect(older).toHaveLength(11);
    expect(older.at(-1)?.time).toBe(firstOldest - MINUTE);
    expect(series.bars[0]?.time).toBe(ORIGIN);
    expect(series.bars).toHaveLength(31);
    expect(series.endOfHistory).toBe(true);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({ to: firstOldest, count: 20, firstPage: false });
    expect(changes.at(-1)).toEqual({ kind: 'older', bars: older });

    expect(await series.loadOlder()).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    series.dispose();
  });

  it('shares one request between concurrent older loads', async () => {
    const { clock, feed } = mockSetup(600);
    const spy = vi.spyOn(feed, 'loadHistory');
    const series = new BarSeries(feed, { instrument: 'MOCK:ACME', timeframe: '5m' }, { pageSize: 10, scheduler: clock });
    await series.loadInitial();
    const [a, b] = await Promise.all([series.loadOlder(), series.loadOlder()]);
    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(series.bars).toHaveLength(20);
    series.dispose();
  });

  it('merges realtime updates and new bars', async () => {
    const { clock, feed } = mockSetup(600);
    const series = new BarSeries(feed, { instrument: 'MOCK:ACME', timeframe: '1m' }, { pageSize: 10, scheduler: clock });
    await series.loadInitial();
    const changes: BarSeriesChange[] = [];
    series.on('change', (change) => changes.push(change));
    const last = series.bars.at(-1) as Bar;

    clock.advance(15_000);
    await feed.tick();
    expect(changes.map((c) => c.kind)).toEqual(['update']);
    expect(series.bars).toHaveLength(10);

    clock.advance(30_000);
    await feed.tick();
    expect(changes.map((c) => c.kind)).toEqual(['update', 'update', 'append']);
    expect(series.bars).toHaveLength(11);
    expect(series.bars.at(-1)?.time).toBe(last.time + MINUTE);
    series.dispose();
  });

  it('stops streaming on dispose and ignores answers that arrive after it', async () => {
    const { clock, feed } = mockSetup(600);
    const series = new BarSeries(feed, { instrument: 'MOCK:ACME', timeframe: '1m' }, { pageSize: 10, scheduler: clock });
    const changes: BarSeriesChange[] = [];
    series.on('change', (change) => changes.push(change));
    const pending = series.loadInitial();
    series.dispose();
    await pending;
    clock.advance(MINUTE);
    await feed.tick();
    expect(changes).toEqual([]);
    expect(series.bars).toEqual([]);
  });
});

describe('BarSeries with scripted feeds', () => {
  it('merges realtime bars that arrive before the first page', async () => {
    let answer: (page: HistoryPage) => void = () => {};
    const { feed, listeners } = scriptedFeed(() => new Promise((resolve) => (answer = resolve)));
    const series = new BarSeries(feed, { instrument: 'X', timeframe: '1m' }, { scheduler: new ManualClock(10 * MINUTE) });
    const loading = series.loadInitial();
    await flush();
    listeners[0]?.onBar(bar(9 * MINUTE, 105));
    listeners[0]?.onBar(bar(10 * MINUTE, 106));
    answer({ bars: [bar(7 * MINUTE), bar(8 * MINUTE), bar(9 * MINUTE)] });
    const bars = await loading;
    expect(bars.map((b) => [b.time / MINUTE, b.close])).toEqual([
      [7, 100],
      [8, 100],
      [9, 105],
      [10, 106],
    ]);
  });

  it('follows olderBarTime across an empty stretch', async () => {
    const day = 24 * 60 * MINUTE;
    const { feed, loadHistory } = scriptedFeed((request) => {
      if (request.firstPage) return { bars: [bar(10 * day), bar(10 * day + MINUTE)] };
      if (request.to > 9 * day) return { bars: [], olderBarTime: 3 * day };
      return { bars: [bar(3 * day - MINUTE), bar(3 * day)], endOfHistory: true };
    });
    const series = new BarSeries(feed, { instrument: 'X', timeframe: '1m' }, { scheduler: new ManualClock(10 * day + 90_000) });
    await series.loadInitial();
    const older = await series.loadOlder();
    expect(older.map((b) => b.time)).toEqual([3 * day - MINUTE, 3 * day]);
    expect(loadHistory.mock.calls[2]?.[0]).toMatchObject({ to: 3 * day + 1, firstPage: false });
    expect(series.endOfHistory).toBe(true);
  });

  it('stops after too many gap jumps and resumes from the gap next time', async () => {
    const { feed, loadHistory } = scriptedFeed((request) => {
      if (request.firstPage) return { bars: [bar(100 * MINUTE)] };
      if (request.to > 10 * MINUTE) return { bars: [], olderBarTime: request.to - 10 * MINUTE };
      return { bars: [bar(MINUTE)], endOfHistory: true };
    });
    const series = new BarSeries(feed, { instrument: 'X', timeframe: '1m' }, { maxGapJumps: 3, scheduler: new ManualClock(100 * MINUTE) });
    await series.loadInitial();
    expect(await series.loadOlder()).toEqual([]);
    expect(series.endOfHistory).toBe(false);
    const lastTo = loadHistory.mock.calls.at(-1)?.[0].to as number;
    await series.loadOlder();
    expect(loadHistory.mock.calls[4]?.[0].to).toBe(lastTo - 10 * MINUTE + 1);
  });

  it('treats an empty page without olderBarTime as the end of history', async () => {
    const { feed } = scriptedFeed((request) => (request.firstPage ? { bars: [bar(5 * MINUTE)] } : { bars: [] }));
    const series = new BarSeries(feed, { instrument: 'X', timeframe: '1m' }, { scheduler: new ManualClock(5 * MINUTE) });
    await series.loadInitial();
    expect(await series.loadOlder()).toEqual([]);
    expect(series.endOfHistory).toBe(true);
  });

  it('reports historyChanged from the stream', async () => {
    const { feed, listeners, unsubscribe } = scriptedFeed(() => ({ bars: [bar(MINUTE)] }));
    const series = new BarSeries(feed, { instrument: 'X', timeframe: '1m' }, { scheduler: new ManualClock(MINUTE) });
    const changed = vi.fn();
    series.on('historyChanged', changed);
    await series.loadInitial();
    listeners[0]?.onHistoryChanged?.();
    expect(changed).toHaveBeenCalledTimes(1);
    series.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('lets a failed first page be retried', async () => {
    let fail = true;
    const { feed } = scriptedFeed(() => {
      if (fail) throw new Error('offline');
      return { bars: [bar(MINUTE)] };
    });
    const series = new BarSeries(feed, { instrument: 'X', timeframe: '1m' }, { scheduler: new ManualClock(MINUTE) });
    await expect(series.loadInitial()).rejects.toThrow('offline');
    expect(series.loading).toBe(false);
    fail = false;
    await expect(series.loadInitial()).resolves.toHaveLength(1);
  });
});
