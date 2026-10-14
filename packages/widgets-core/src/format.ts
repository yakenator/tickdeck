import { decimalPlaces, formatDecimal } from '@tickdeck/core';

export interface AmountFormatOptions {
  /** Prefix positive values with `+`. */
  signed?: boolean;
  /** Group thousands with `,`. Default true. */
  grouping?: boolean;
}

/**
 * Formats a number with exactly `decimals` places, computed in decimal so
 * float noise never shows. `undefined` and non-finite values become `''`.
 *
 * @example formatAmount(1234.5, 2) // '1,234.50'
 * @example formatAmount(15, 2, { signed: true }) // '+15.00'
 */
export function formatAmount(value: number | undefined, decimals: number, options: AmountFormatOptions = {}): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const text = formatDecimal(value, Math.max(0, decimals));
  const negative = text.startsWith('-');
  const [integer = '0', fraction] = (negative ? text.slice(1) : text).split('.');
  const grouped = options.grouping === false ? integer : integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isZero = /^[0.,]*$/.test(integer + (fraction ?? ''));
  const sign = negative && !isZero ? '-' : options.signed && !isZero ? '+' : '';
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/**
 * Text for an editable number field: at least `decimals` places, more when
 * the value has them (so an off-tick entry stays visible), no grouping.
 */
export function formatInputNumber(value: number | undefined, decimals: number): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return formatDecimal(value, Math.max(decimals, decimalPlaces(value)));
}

/** Parses a number typed by the user. Blank text is `undefined`, anything unreadable is `NaN`. */
export function parseInputNumber(text: string): number | undefined {
  const trimmed = text.trim().replace(/[\s_,]/g, '');
  if (trimmed === '') return undefined;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const currencyDigits = new Map<string, number>();

/** Decimal places normally used for amounts in `currency` (2 for USD, 0 for JPY). */
export function moneyPrecision(currency: string | undefined): number {
  if (!currency) return 2;
  let digits = currencyDigits.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    currencyDigits.set(currency, digits);
  }
  return digits;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let format = clockFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    clockFormats.set(key, format);
  }
  return format;
}

function clockParts(time: number, timeZone: string | undefined): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of clockFormat(timeZone).formatToParts(time)) parts[part.type] = part.value;
  return parts;
}

/**
 * `HH:MM:SS` for times on the same day as `now`, `MM-DD HH:MM` otherwise,
 * in `timeZone` (default: the host's).
 */
export function formatTimeOfDay(time: number | undefined, now: number, timeZone?: string): string {
  if (time === undefined || !Number.isFinite(time)) return '';
  const at = clockParts(time, timeZone);
  const today = clockParts(now, timeZone);
  if (at.year === today.year && at.month === today.month && at.day === today.day) {
    return `${at.hour}:${at.minute}:${at.second}`;
  }
  return `${at.month}-${at.day} ${at.hour}:${at.minute}`;
}
