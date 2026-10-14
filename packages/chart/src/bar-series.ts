import { Emitter, systemScheduler, type Bar, type Listener, type Scheduler, type Unsubscribe } from '@tickdeck/core';
import { parseTimeframe, timeframeDuration, type MarketFeed } from '@tickdeck/datafeed';

const DAY = 86_400_000;

export interface BarSeriesOptions {
  /** Bars asked for per history page (`count` in the request). Default 500. */
  pageSize?: number;
  /** Clock used for the end of the first page. Default: the host's. */
  scheduler?: Scheduler;
  /**
   * Empty pages followed through `olderBarTime` gaps in one load before
   * stopping. Paging resumes from the gap on the next call. Default 10.
   */
  maxGapJumps?: number;
}

/**
 * How the bars changed:
 * - `reset`: the first page arrived; `bars` is the whole series.
 * - `older`: an older page was added in front; `bars` holds only the new bars.
 * - `update`: the newest bar was replaced.
 * - `append`: a new bar started.
 */
export type BarSeriesChange =
  | { kind: 'reset'; bars: readonly Bar[] }
  | { kind: 'older'; bars: readonly Bar[] }
  | { kind: 'update'; bar: Bar }
  | { kind: 'append'; bar: Bar };

export interface BarSeriesEvents {
  change: BarSeriesChange;
  /** The feed reported that past bars changed. Discard this series and load a new one. */
  historyChanged: void;
}

/** Where a realtime bar went. */
export type BarMerge = 'update' | 'append' | 'ignore';

/**
 * Merges a realtime bar into `bars` (ascending, changed in place): a bar with
 * the newest time replaces it, a later one is appended, an older one is ignored.
 */
export function mergeBar(bars: Bar[], bar: Bar): BarMerge {
  const last = bars[bars.length - 1];
  if (!last || bar.time > last.time) {
    bars.push(bar);
    return 'append';
  }
  if (bar.time === last.time) {
    bars[bars.length - 1] = bar;
    return 'update';
  }
  return 'ignore';
}

/** Sorts a history page by time, drops duplicate times and keeps only bars before `before`. */
export function normalizePage(bars: readonly Bar[], before: number): Bar[] {
  const sorted = bars.filter((bar) => Number.isFinite(bar.time) && bar.time < before).sort((a, b) => a.time - b.time);
  return sorted.filter((bar, index) => index === 0 || bar.time !== sorted[index - 1]?.time);
}

/** Typical length of one bar in milliseconds, used to size history requests (months count 31 days, ticks one second). */
export function approximateBarLength(timeframe: string): number {
  const parsed = parseTimeframe(timeframe);
  return timeframeDuration(parsed) ?? (parsed.unit === 'month' ? parsed.count * 31 * DAY : parsed.count * 1_000);
}

/**
 * The bars of one instrument and timeframe, loaded from a `MarketFeed`:
 * the newest page first, older pages on demand, and realtime updates merged
 * as they stream in. It has no DOM or rendering code, so custom charts can
 * use it directly.
 *
 * A series serves one instrument and timeframe for its whole life. When the
 * feed reports `historyChanged`, dispose it and create a new one.
 */
export class BarSeries {
  readonly feed: MarketFeed;
  readonly instrument: string;
  readonly timeframe: string;
  readonly #events = new Emitter<BarSeriesEvents>();
  readonly #pageSize: number;
  readonly #scheduler: Scheduler;
  readonly #maxGapJumps: number;
  readonly #barLength: number;
  readonly #bars: Bar[] = [];
  readonly #buffer: Bar[] = [];
  #loaded = false;
  #endOfHistory = false;
  /** Exclusive end of the next older page when a gap jump stopped early. */
  #resumeAt: number | undefined;
  #initial: Promise<readonly Bar[]> | undefined;
  #older: Promise<readonly Bar[]> | undefined;
  #unsubscribe: Unsubscribe | undefined;
  #disposed = false;

  constructor(feed: MarketFeed, request: { instrument: string; timeframe: string }, options: BarSeriesOptions = {}) {
    this.feed = feed;
    this.instrument = request.instrument;
    this.timeframe = request.timeframe;
    this.#barLength = approximateBarLength(request.timeframe);
    this.#pageSize = Math.max(1, Math.floor(options.pageSize ?? 500));
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#maxGapJumps = options.maxGapJumps ?? 10;
  }

  /** Loaded bars, oldest first. The array is updated in place. */
  get bars(): readonly Bar[] {
    return this.#bars;
  }

  /** The first page has arrived. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /** The feed has no bars older than the first one loaded. */
  get endOfHistory(): boolean {
    return this.#endOfHistory;
  }

  /** A history request is in flight. */
  get loading(): boolean {
    return (this.#initial !== undefined && !this.#loaded) || this.#older !== undefined;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  on<K extends keyof BarSeriesEvents>(event: K, listener: Listener<BarSeriesEvents[K]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  /**
   * Starts the realtime stream and loads the newest page. Realtime bars that
   * arrive before the page are merged into it. Calling it again returns the
   * same promise; after a failure, the next call retries.
   */
  loadInitial(): Promise<readonly Bar[]> {
    if (!this.#initial) {
      const request = this.#loadInitial();
      this.#initial = request;
      request.catch(() => {
        if (this.#initial === request) this.#initial = undefined;
      });
    }
    return this.#initial;
  }

  /**
   * Loads the page before the oldest bar and puts it in front. Resolves with
   * the bars added, which is empty at the end of history. Concurrent calls
   * share one request.
   */
  loadOlder(): Promise<readonly Bar[]> {
    if (!this.#loaded || this.#endOfHistory || this.#disposed) return Promise.resolve([]);
    if (!this.#older) {
      const request = this.#loadOlder();
      this.#older = request;
      const clear = () => {
        if (this.#older === request) this.#older = undefined;
      };
      request.then(clear, clear);
    }
    return this.#older;
  }

  /** Stops the realtime stream. Pending loads resolve without changing anything. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#buffer.length = 0;
    this.#events.removeAllListeners();
  }

  async #loadInitial(): Promise<readonly Bar[]> {
    this.#subscribe();
    const bars = await this.#fetchBack(this.#scheduler.now() + this.#barLength, true);
    if (this.#disposed) return this.#bars;
    this.#bars.push(...bars);
    this.#loaded = true;
    for (const bar of this.#buffer.splice(0)) mergeBar(this.#bars, bar);
    this.#events.emit('change', { kind: 'reset', bars: this.#bars });
    return this.#bars;
  }

  async #loadOlder(): Promise<readonly Bar[]> {
    const oldest = this.#bars[0]?.time;
    const to = this.#resumeAt ?? oldest ?? this.#scheduler.now() + this.#barLength;
    const page = await this.#fetchBack(to, false);
    if (this.#disposed) return [];
    const older = oldest === undefined ? page : page.filter((bar) => bar.time < oldest);
    if (older.length === 0) return older;
    this.#bars.unshift(...older);
    this.#events.emit('change', { kind: 'older', bars: older });
    return older;
  }

  /** One page of bars before `to`, following `olderBarTime` across empty stretches. */
  async #fetchBack(to: number, firstPage: boolean): Promise<Bar[]> {
    let end = to;
    let first = firstPage;
    for (let jumps = 0; ; jumps++) {
      const page = await this.feed.loadHistory({
        instrument: this.instrument,
        timeframe: this.timeframe,
        from: end - this.#pageSize * this.#barLength,
        to: end,
        count: this.#pageSize,
        firstPage: first,
      });
      first = false;
      if (this.#disposed) return [];
      const bars = normalizePage(page.bars, end);
      this.#resumeAt = undefined;
      if (bars.length > 0) {
        this.#endOfHistory = page.endOfHistory === true;
        return bars;
      }
      const older = page.olderBarTime;
      if (page.endOfHistory || older === undefined || !(older < end)) {
        // An empty page with nothing to jump to: `count` asked for older bars and none exist.
        this.#endOfHistory = true;
        return [];
      }
      end = older + 1;
      if (jumps + 1 >= this.#maxGapJumps) {
        this.#resumeAt = end;
        return [];
      }
    }
  }

  #subscribe(): void {
    if (this.#unsubscribe || this.#disposed) return;
    this.#unsubscribe = this.feed.streamBars(
      { instrument: this.instrument, timeframe: this.timeframe },
      {
        onBar: (bar) => this.#onBar({ ...bar }),
        onHistoryChanged: () => {
          if (!this.#disposed) this.#events.emit('historyChanged', undefined);
        },
      },
    );
  }

  #onBar(bar: Bar): void {
    if (this.#disposed) return;
    if (!this.#loaded) {
      this.#buffer.push(bar);
      return;
    }
    const merge = mergeBar(this.#bars, bar);
    if (merge !== 'ignore') this.#events.emit('change', { kind: merge, bar });
  }
}
