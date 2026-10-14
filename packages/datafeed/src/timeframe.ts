export type TimeframeUnit = 'tick' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';

/** A parsed timeframe: `count` units per bar. */
export interface Timeframe {
  count: number;
  unit: TimeframeUnit;
}

const UNIT_BY_SUFFIX: Record<string, TimeframeUnit> = {
  t: 'tick',
  s: 'second',
  m: 'minute',
  h: 'hour',
  D: 'day',
  W: 'week',
  M: 'month',
};

const SUFFIX_BY_UNIT = Object.fromEntries(
  Object.entries(UNIT_BY_SUFFIX).map(([suffix, unit]) => [unit, suffix]),
) as Record<TimeframeUnit, string>;

const UNIT_MS: Partial<Record<TimeframeUnit, number>> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

const UNIT_ORDER: readonly TimeframeUnit[] = ['tick', 'second', 'minute', 'hour', 'day', 'week', 'month'];

// 1970-01-01 was a Thursday; weeks start on Monday 1970-01-05.
const WEEK_ORIGIN = 4 * 86_400_000;

const PATTERN = /^([1-9]\d*)([tsmhDWM])$/;

/**
 * Parses a timeframe string: a positive count followed by a unit. Lowercase
 * units are intraday, uppercase are calendar units, and case matters:
 * `t` ticks, `s` seconds, `m` minutes, `h` hours, `D` days, `W` weeks, `M` months.
 *
 * @example parseTimeframe('15m') // { count: 15, unit: 'minute' }
 * @example parseTimeframe('100t') // { count: 100, unit: 'tick' }
 * @throws RangeError when the string is not a valid timeframe.
 */
export function parseTimeframe(text: string): Timeframe {
  const parsed = tryParseTimeframe(text);
  if (!parsed) throw new RangeError(`Invalid timeframe "${text}"`);
  return parsed;
}

export function tryParseTimeframe(text: string): Timeframe | undefined {
  const match = PATTERN.exec(text);
  if (!match) return undefined;
  const count = Number(match[1]);
  const unit = UNIT_BY_SUFFIX[match[2] as string];
  if (!unit || !Number.isSafeInteger(count)) return undefined;
  return { count, unit };
}

export function formatTimeframe(timeframe: Timeframe): string {
  if (!Number.isSafeInteger(timeframe.count) || timeframe.count < 1) {
    throw new RangeError(`Invalid timeframe count ${timeframe.count}`);
  }
  return `${timeframe.count}${SUFFIX_BY_UNIT[timeframe.unit]}`;
}

function asTimeframe(timeframe: Timeframe | string): Timeframe {
  return typeof timeframe === 'string' ? parseTimeframe(timeframe) : timeframe;
}

/**
 * Fixed bar length in milliseconds, or `undefined` for tick bars (variable)
 * and months (calendar length).
 */
export function timeframeDuration(timeframe: Timeframe | string): number | undefined {
  const { count, unit } = asTimeframe(timeframe);
  const unitMs = UNIT_MS[unit];
  return unitMs === undefined ? undefined : count * unitMs;
}

/** Sort order: ticks first, then by length. Months compare by count as 30-day units. */
export function compareTimeframes(a: Timeframe | string, b: Timeframe | string): number {
  const left = asTimeframe(a);
  const right = asTimeframe(b);
  if (left.unit === 'tick' || right.unit === 'tick') {
    if (left.unit !== right.unit) return left.unit === 'tick' ? -1 : 1;
    return left.count - right.count;
  }
  const length = (tf: Timeframe) => tf.count * (UNIT_MS[tf.unit] ?? 30 * 86_400_000);
  return length(left) - length(right) || UNIT_ORDER.indexOf(left.unit) - UNIT_ORDER.indexOf(right.unit);
}

/**
 * Open time of the bar that contains `time`, aligned in UTC: seconds to
 * hours on multiples since the epoch, days at UTC midnight, weeks on Monday,
 * months on the first of the month (multi-month bars on multiples since
 * January 1970). Feeds with exchange-local sessions align bars themselves.
 *
 * @throws RangeError for tick timeframes, which have no time grid.
 */
export function barOpenTime(time: number, timeframe: Timeframe | string): number {
  const { count, unit } = asTimeframe(timeframe);
  if (unit === 'tick') throw new RangeError('Tick bars have no time grid');
  if (unit === 'month') {
    const date = new Date(time);
    const months = date.getUTCFullYear() * 12 + date.getUTCMonth() - 1970 * 12;
    const aligned = Math.floor(months / count) * count;
    return Date.UTC(1970, aligned, 1);
  }
  const length = count * (UNIT_MS[unit] as number);
  const origin = unit === 'week' ? WEEK_ORIGIN : 0;
  return Math.floor((time - origin) / length) * length + origin;
}

/** Open time of the bar after the one that opens at `openTime`. */
export function nextBarOpenTime(openTime: number, timeframe: Timeframe | string): number {
  const parsed = asTimeframe(timeframe);
  if (parsed.unit === 'tick') throw new RangeError('Tick bars have no time grid');
  if (parsed.unit === 'month') {
    const date = new Date(openTime);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + parsed.count, 1);
  }
  return openTime + (timeframeDuration(parsed) as number);
}
