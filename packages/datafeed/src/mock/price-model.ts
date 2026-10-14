import { createRandom, hash32, normal, unitFloat } from './random';

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const DAY = 86_400_000;
const MINUTES_PER_DAY = 1_440;
const SECONDS_PER_MINUTE = 60;
const MEAN_REVERSION = 0.005;

/** Unrounded OHLCV over an interval. */
export interface Segment {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceModelSpec {
  seed: number;
  /** Start of the path, UTC midnight. */
  origin: number;
  startPrice: number;
  /** Typical daily move as a fraction of price. */
  volatility: number;
  /** Average volume per minute. */
  baseVolume: number;
}

interface SecondPath {
  prices: Float64Array;
  volumes: Float64Array;
}

export function mergeSegment(target: Segment, next: Segment): void {
  if (next.high > target.high) target.high = next.high;
  if (next.low < target.low) target.low = next.low;
  target.close = next.close;
  target.volume += next.volume;
}

class LruCache<V> {
  readonly #entries = new Map<number, V>();
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  get(key: number, create: () => V): V {
    const hit = this.#entries.get(key);
    if (hit !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, hit);
      return hit;
    }
    const value = create();
    this.#entries.set(key, value);
    if (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value as number;
      this.#entries.delete(oldest);
    }
    return value;
  }
}

/**
 * Deterministic price path. A daily random walk (with mild mean reversion)
 * fixes one price per UTC midnight; Brownian bridges fill in minutes between
 * days. Inside a minute, a bridge pinned at the minute's open, high, low and
 * close gives one price per second. Every value depends only on the seed and
 * the time, so any timeframe can be generated on demand, and bars at different
 * timeframes agree with each other exactly.
 */
export class PriceModel {
  readonly origin: number;
  readonly #spec: PriceModelSpec;
  readonly #anchors: number[];
  readonly #anchorRandom: () => number;
  readonly #minutePaths = new LruCache<Float64Array>(64);
  readonly #secondPaths = new LruCache<SecondPath>(32);
  readonly #days = new Map<number, Segment>();

  constructor(spec: PriceModelSpec) {
    this.#spec = spec;
    this.origin = Math.floor(spec.origin / DAY) * DAY;
    this.#anchors = [spec.startPrice];
    this.#anchorRandom = createRandom(hash32(spec.seed, 1));
  }

  #anchor(day: number): number {
    const { startPrice, volatility } = this.#spec;
    while (this.#anchors.length <= day) {
      const previous = this.#anchors[this.#anchors.length - 1] as number;
      const next =
        previous * (1 + volatility * normal(this.#anchorRandom)) + MEAN_REVERSION * (startPrice - previous);
      this.#anchors.push(Math.max(next, startPrice * 0.05));
    }
    return this.#anchors[day] as number;
  }

  #minuteScale(day: number): number {
    return (this.#spec.volatility * this.#anchor(day)) / Math.sqrt(MINUTES_PER_DAY);
  }

  #minutePath(day: number): Float64Array {
    return this.#minutePaths.get(day, () => {
      const from = this.#anchor(day);
      const to = this.#anchor(day + 1);
      return bridge(from, to, MINUTES_PER_DAY, this.#minuteScale(day), createRandom(hash32(this.#spec.seed, 2, day)));
    });
  }

  /** OHLCV of minute `index` (minutes since the origin). The close equals the next minute's open. */
  minute(index: number): Segment {
    const day = Math.floor(index / MINUTES_PER_DAY);
    return this.#minuteFrom(this.#minutePath(day), index, index - day * MINUTES_PER_DAY, this.#minuteScale(day) * 0.8);
  }

  #minuteFrom(path: Float64Array, index: number, offset: number, scale: number): Segment {
    const open = path[offset] as number;
    const close = path[offset + 1] as number;
    const h = hash32(this.#spec.seed, 3, index);
    const high = Math.max(open, close) + unitFloat(h) * scale;
    const low = Math.max(Math.min(open, close) - unitFloat(hash32(h, 1)) * scale, open * 0.01);
    const volume = Math.round(this.#spec.baseVolume * (0.3 + 1.4 * unitFloat(hash32(h, 2))));
    return { open, high, low, close, volume };
  }

  /**
   * Prices at each second of a minute (61 points, open to close). The path
   * passes through the minute's high and low, and the minute's volume is split
   * across its seconds, so second bars add up exactly to the minute bar.
   */
  #secondPath(minuteIndex: number): SecondPath {
    return this.#secondPaths.get(minuteIndex, () => {
      const minute = this.minute(minuteIndex);
      const day = Math.floor(minuteIndex / MINUTES_PER_DAY);
      const scale = this.#minuteScale(day) / Math.sqrt(SECONDS_PER_MINUTE);
      const h = hash32(this.#spec.seed, 4, minuteIndex);
      const random = createRandom(h);
      const first = 1 + Math.floor(random() * (SECONDS_PER_MINUTE - 1));
      let second = 1 + Math.floor(random() * (SECONDS_PER_MINUTE - 2));
      if (second >= first) second += 1;
      const highFirst = random() < 0.5;
      const pins: Array<[number, number]> = [
        [0, minute.open],
        [Math.min(first, second), highFirst ? minute.high : minute.low],
        [Math.max(first, second), highFirst ? minute.low : minute.high],
        [SECONDS_PER_MINUTE, minute.close],
      ];
      const prices = new Float64Array(SECONDS_PER_MINUTE + 1);
      for (let i = 0; i < pins.length - 1; i++) {
        const [start, from] = pins[i] as [number, number];
        const [end, to] = pins[i + 1] as [number, number];
        const piece = bridge(from, to, end - start, scale, random);
        prices.set(piece, start);
      }
      for (let i = 0; i < prices.length; i++) {
        prices[i] = Math.min(Math.max(prices[i] as number, minute.low), minute.high);
      }

      const weights = new Float64Array(SECONDS_PER_MINUTE + 1);
      for (let i = 0; i < SECONDS_PER_MINUTE; i++) weights[i + 1] = (weights[i] as number) + 0.5 + random();
      const total = weights[SECONDS_PER_MINUTE] as number;
      const volumes = new Float64Array(SECONDS_PER_MINUTE);
      for (let i = 0; i < SECONDS_PER_MINUTE; i++) {
        volumes[i] =
          Math.round((minute.volume * (weights[i + 1] as number)) / total) -
          Math.round((minute.volume * (weights[i] as number)) / total);
      }
      return { prices, volumes };
    });
  }

  /** OHLCV of the second starting at `time` (UTC ms, second-aligned, at or after the origin). */
  second(time: number): Segment {
    const index = Math.floor((time - this.origin) / SECOND);
    const minuteIndex = Math.floor(index / SECONDS_PER_MINUTE);
    const { prices, volumes } = this.#secondPath(minuteIndex);
    const offset = index - minuteIndex * SECONDS_PER_MINUTE;
    const open = prices[offset] as number;
    const close = prices[offset + 1] as number;
    return { open, high: Math.max(open, close), low: Math.min(open, close), close, volume: volumes[offset] as number };
  }

  /** Price at `time`, floored to the second. */
  priceAt(time: number): number {
    return this.second(Math.floor((time - this.origin) / SECOND) * SECOND + this.origin).open;
  }

  #day(index: number): Segment {
    let segment = this.#days.get(index);
    if (!segment) {
      const path = this.#minutePath(index);
      const scale = this.#minuteScale(index) * 0.8;
      const first = index * MINUTES_PER_DAY;
      segment = this.#minuteFrom(path, first, 0, scale);
      for (let i = 1; i < MINUTES_PER_DAY; i++) mergeSegment(segment, this.#minuteFrom(path, first + i, i, scale));
      this.#days.set(index, segment);
    }
    return segment;
  }

  /**
   * OHLCV from `from` to `to` (both second-aligned, `from >= origin`). The
   * open is the price at `from`, the close the price at `to`, volume covers
   * `[from, to)`. A zero-length interval yields a flat segment with no volume.
   */
  aggregate(from: number, to: number): Segment {
    let result: Segment | undefined;
    const add = (segment: Segment) => {
      if (result) mergeSegment(result, segment);
      else result = { ...segment };
    };
    const origin = this.origin;
    let t = from;
    while (t < to && (t - origin) % MINUTE !== 0) {
      add(this.second(t));
      t += SECOND;
    }
    while (t + MINUTE <= to && (t - origin) % DAY !== 0) {
      add(this.minute((t - origin) / MINUTE));
      t += MINUTE;
    }
    while (t + DAY <= to) {
      add(this.#day((t - origin) / DAY));
      t += DAY;
    }
    while (t + MINUTE <= to) {
      add(this.minute((t - origin) / MINUTE));
      t += MINUTE;
    }
    while (t < to) {
      add(this.second(t));
      t += SECOND;
    }
    if (result) return result;
    const price = this.priceAt(from);
    return { open: price, high: price, low: price, close: price, volume: 0 };
  }
}

/** Random walk of `steps` steps from `from`, bent so that it ends exactly at `to`. */
function bridge(from: number, to: number, steps: number, scale: number, random: () => number): Float64Array {
  const walk = new Float64Array(steps + 1);
  for (let i = 1; i <= steps; i++) walk[i] = (walk[i - 1] as number) + scale * normal(random);
  const drift = (walk[steps] as number) - (to - from);
  const floor = Math.min(from, to) * 0.01;
  for (let i = 0; i <= steps; i++) {
    walk[i] = Math.max(from + (walk[i] as number) - (i / steps) * drift, floor);
  }
  walk[steps] = to;
  return walk;
}
