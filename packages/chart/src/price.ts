import { decimalPlaces, formatDecimal, roundToTick, type Instrument } from '@tickdeck/core';

/** The instrument fields that drive price rounding and display. */
export type PriceRules = Pick<Instrument, 'tickSize' | 'pricePrecision'>;

/** Rounds a price to the nearest multiple of the tick size (halves away from zero). */
export function snapPrice(price: number, tickSize: number): number {
  return roundToTick(price, tickSize);
}

/**
 * Rounds a price for an order: to the nearest tick, and never below one tick,
 * so a line dragged to the bottom of the chart still yields a valid price.
 */
export function snapOrderPrice(price: number, tickSize: number): number {
  return Math.max(snapPrice(price, tickSize), tickSize);
}

/** Decimal places used to show prices: the instrument's precision, widened if the tick size needs more. */
export function priceDecimals(rules: PriceRules): number {
  return Math.max(rules.pricePrecision, decimalPlaces(rules.tickSize));
}

/** Formats a price with the instrument's precision, e.g. `101.50`. */
export function formatPrice(price: number, rules: PriceRules): string {
  return formatDecimal(price, priceDecimals(rules));
}

/** Fixed decimals with an explicit `+` for positive values and no sign on a rounded zero. */
function signedFixed(value: number, places: number): string {
  const text = formatDecimal(value, places);
  if (/^-?[0.]+$/.test(text)) return text.replace('-', '');
  return value > 0 ? `+${text}` : text;
}

/** Formats a money amount with a sign and two decimals, e.g. `+125.50 USD`. */
export function formatMoney(value: number, currency?: string): string {
  const text = signedFixed(value, 2);
  return currency ? `${text} ${currency}` : text;
}

/** Formats a distance in ticks, e.g. `+12 ticks`. Fractional distances keep one decimal. */
export function formatTicks(ticks: number): string {
  const places = Number.isInteger(Math.round(ticks * 10) / 10) ? 0 : 1;
  const text = signedFixed(ticks, places);
  return `${text} ${Math.abs(Number(text)) === 1 ? 'tick' : 'ticks'}`;
}

/** Formats a percentage with a sign and two decimals, e.g. `-0.85%`. */
export function formatPercent(percent: number): string {
  return `${signedFixed(percent, 2)}%`;
}
