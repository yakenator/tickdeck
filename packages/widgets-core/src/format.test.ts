import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatDateTimeInput,
  formatInputNumber,
  formatTimeOfDay,
  isValidTimeZone,
  moneyPrecision,
  parseDateTimeInput,
  parseInputNumber,
} from './format';

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

  it('round-trips date and time fields in a time zone, across daylight saving changes', () => {
    const time = Date.UTC(2026, 0, 15, 14, 30);
    expect(formatDateTimeInput(time, 'Etc/UTC')).toBe('2026-01-15T14:30');
    expect(formatDateTimeInput(time, 'America/New_York')).toBe('2026-01-15T09:30');
    expect(formatDateTimeInput(time, 'Asia/Seoul')).toBe('2026-01-15T23:30');
    expect(formatDateTimeInput(undefined, 'Etc/UTC')).toBe('');
    expect(parseDateTimeInput('2026-01-15T09:30', 'America/New_York')).toBe(time);
    expect(parseDateTimeInput('2026-01-15T23:30', 'Asia/Seoul')).toBe(time);
    expect(parseDateTimeInput('2026-01-15T14:30:15', 'Etc/UTC')).toBe(time + 15_000);
    // New York moves to daylight time at 02:00 on 2026-03-08 and back at 02:00 on 2026-11-01.
    expect(parseDateTimeInput('2026-03-08T03:30', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30));
    expect(parseDateTimeInput('2026-03-08T10:00', 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 14, 0));
    expect(parseDateTimeInput('2026-11-01T12:00', 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 17, 0));
    for (const zone of ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kolkata']) {
      for (let hour = 0; hour < 24 * 400; hour += 7) {
        const at = Date.UTC(2026, 0, 1) + hour * 3_600_000;
        expect(parseDateTimeInput(formatDateTimeInput(at, zone), zone)).toBe(at - (at % 60_000));
      }
    }
    expect(parseDateTimeInput('', 'Etc/UTC')).toBeUndefined();
    expect(parseDateTimeInput('tomorrow', 'Etc/UTC')).toBeNaN();
  });

  it('checks time zone names', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
