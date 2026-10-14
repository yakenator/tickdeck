import { describe, expect, it } from 'vitest';
import {
  barOpenTime,
  compareTimeframes,
  formatTimeframe,
  nextBarOpenTime,
  parseTimeframe,
  timeframeDuration,
  tryParseTimeframe,
} from './timeframe';

describe('timeframe strings', () => {
  it('parses every unit', () => {
    expect(parseTimeframe('100t')).toEqual({ count: 100, unit: 'tick' });
    expect(parseTimeframe('15s')).toEqual({ count: 15, unit: 'second' });
    expect(parseTimeframe('5m')).toEqual({ count: 5, unit: 'minute' });
    expect(parseTimeframe('4h')).toEqual({ count: 4, unit: 'hour' });
    expect(parseTimeframe('1D')).toEqual({ count: 1, unit: 'day' });
    expect(parseTimeframe('2W')).toEqual({ count: 2, unit: 'week' });
    expect(parseTimeframe('3M')).toEqual({ count: 3, unit: 'month' });
  });

  it('is strict about case, count and unit', () => {
    for (const bad of ['', 'm', '0m', '05m', '1d', '1H', '1.5m', '-1m', '1 m', '1mo', 'D']) {
      expect(tryParseTimeframe(bad), bad).toBeUndefined();
    }
    expect(() => parseTimeframe('1d')).toThrow(RangeError);
  });

  it('formats back to the same string', () => {
    for (const text of ['1t', '30s', '1m', '90m', '1h', '1D', '1W', '12M']) {
      expect(formatTimeframe(parseTimeframe(text))).toBe(text);
    }
    expect(() => formatTimeframe({ count: 0, unit: 'minute' })).toThrow(RangeError);
  });

  it('knows fixed durations', () => {
    expect(timeframeDuration('90s')).toBe(90_000);
    expect(timeframeDuration('1h')).toBe(timeframeDuration('60m'));
    expect(timeframeDuration('1W')).toBe(7 * 86_400_000);
    expect(timeframeDuration('1M')).toBeUndefined();
    expect(timeframeDuration('10t')).toBeUndefined();
  });

  it('sorts ticks first, then by length', () => {
    const sorted = ['1D', '1M', '5m', '100t', '1h', '30s', '10t', '1W', '60m'].sort(compareTimeframes);
    expect(sorted).toEqual(['10t', '100t', '30s', '5m', '60m', '1h', '1D', '1W', '1M']);
  });
});

describe('bar alignment', () => {
  const at = Date.UTC(2026, 9, 14, 13, 47, 31, 250); // Wednesday

  it('aligns intraday bars on the epoch grid', () => {
    expect(barOpenTime(at, '1s')).toBe(Date.UTC(2026, 9, 14, 13, 47, 31));
    expect(barOpenTime(at, '15m')).toBe(Date.UTC(2026, 9, 14, 13, 45));
    expect(barOpenTime(at, '4h')).toBe(Date.UTC(2026, 9, 14, 12));
    expect(nextBarOpenTime(Date.UTC(2026, 9, 14, 13, 45), '15m')).toBe(Date.UTC(2026, 9, 14, 14));
  });

  it('aligns days, Monday weeks and calendar months in UTC', () => {
    expect(barOpenTime(at, '1D')).toBe(Date.UTC(2026, 9, 14));
    expect(barOpenTime(at, '1W')).toBe(Date.UTC(2026, 9, 12));
    expect(barOpenTime(Date.UTC(2026, 9, 12), '1W')).toBe(Date.UTC(2026, 9, 12));
    expect(barOpenTime(at, '1M')).toBe(Date.UTC(2026, 9, 1));
    expect(barOpenTime(at, '3M')).toBe(Date.UTC(2026, 9, 1));
    expect(barOpenTime(Date.UTC(2026, 7, 20), '3M')).toBe(Date.UTC(2026, 6, 1));
    expect(nextBarOpenTime(Date.UTC(2026, 11, 1), '1M')).toBe(Date.UTC(2027, 0, 1));
    expect(nextBarOpenTime(Date.UTC(2026, 9, 12), '1W')).toBe(Date.UTC(2026, 9, 19));
  });

  it('refuses to align tick bars', () => {
    expect(() => barOpenTime(at, '100t')).toThrow(RangeError);
  });
});
