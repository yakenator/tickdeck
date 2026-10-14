import { describe, expect, it } from 'vitest';
import { formatAmount, formatInputNumber, formatTimeOfDay, moneyPrecision, parseInputNumber } from './format';

describe('formatting', () => {
  it('formats amounts in decimal with grouping and an optional sign', () => {
    expect(formatAmount(1234567.5, 2)).toBe('1,234,567.50');
    expect(formatAmount(0.1 + 0.2, 2)).toBe('0.30');
    expect(formatAmount(-15, 2, { signed: true })).toBe('-15.00');
    expect(formatAmount(15, 2, { signed: true })).toBe('+15.00');
    expect(formatAmount(-0.001, 2, { signed: true })).toBe('0.00');
    expect(formatAmount(40000.5, 1, { grouping: false })).toBe('40000.5');
    expect(formatAmount(undefined, 2)).toBe('');
    expect(formatAmount(Number.NaN, 2)).toBe('');
  });

  it('round-trips editable numbers', () => {
    expect(formatInputNumber(99.5, 2)).toBe('99.50');
    expect(formatInputNumber(99.555, 2)).toBe('99.555');
    expect(parseInputNumber(' 1,000.5 ')).toBe(1000.5);
    expect(parseInputNumber('')).toBeUndefined();
    expect(parseInputNumber('.5')).toBe(0.5);
    expect(parseInputNumber('12abc')).toBeNaN();
  });

  it('knows currency digits and formats times of day', () => {
    expect(moneyPrecision('USD')).toBe(2);
    expect(moneyPrecision('JPY')).toBe(0);
    expect(moneyPrecision('not a currency')).toBe(2);
    const now = Date.UTC(2026, 9, 14, 12, 0, 30);
    expect(formatTimeOfDay(Date.UTC(2026, 9, 14, 9, 5, 7), now, 'Etc/UTC')).toBe('09:05:07');
    expect(formatTimeOfDay(Date.UTC(2026, 9, 13, 23, 59, 0), now, 'Etc/UTC')).toBe('10-13 23:59');
    expect(formatTimeOfDay(Date.UTC(2026, 9, 13, 23, 59, 0), now, 'Asia/Seoul')).toBe('08:59:00');
  });
});
