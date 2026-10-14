import { Decimal as DecimalBase } from 'decimal.js';
import type { QuantityRules } from './types';

// A private configuration, so the application's own decimal.js settings are untouched.
const Decimal = DecimalBase.clone({ precision: 34, rounding: DecimalBase.ROUND_HALF_UP });
type Decimal = DecimalBase;

// Differences smaller than this fraction of a step count as binary floating-point noise.
const STEP_TOLERANCE = new Decimal('1e-9');

/**
 * - `nearest`: to the closest multiple, halves away from zero.
 * - `down`: towards negative infinity.
 * - `up`: towards positive infinity.
 */
export type RoundingMode = 'nearest' | 'down' | 'up';

const roundingFor: Record<RoundingMode, DecimalBase.Rounding> = {
  nearest: Decimal.ROUND_HALF_UP,
  down: Decimal.ROUND_FLOOR,
  up: Decimal.ROUND_CEIL,
};

function toDecimal(value: number, name = 'value'): Decimal {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number, got ${value}`);
  return new Decimal(value);
}

function positiveStep(step: number, name: string): Decimal {
  const decimal = toDecimal(step, name);
  if (decimal.lte(0)) throw new RangeError(`${name} must be positive, got ${step}`);
  return decimal;
}

/** Rounds `value` to a multiple of `step`, counting from zero. */
export function roundToStep(value: number, step: number, mode: RoundingMode = 'nearest'): number {
  const size = positiveStep(step, 'step');
  return toDecimal(value)
    .div(size)
    .toDecimalPlaces(0, roundingFor[mode])
    .mul(size)
    .toNumber();
}

/** Rounds a price to the instrument's tick size. */
export function roundToTick(price: number, tickSize: number, mode: RoundingMode = 'nearest'): number {
  return roundToStep(price, tickSize, mode);
}

function isWholeMultiple(value: Decimal, step: Decimal): boolean {
  const units = value.div(step);
  return units.minus(units.round()).abs().lte(STEP_TOLERANCE);
}

/** Whether `price` is a multiple of `tickSize` (ignoring floating-point noise). */
export function isOnTick(price: number, tickSize: number): boolean {
  return isWholeMultiple(toDecimal(price, 'price'), positiveStep(tickSize, 'tickSize'));
}

export type QuantityProblem = 'not-finite' | 'not-positive' | 'below-min' | 'above-max' | 'off-step';

/** Checks an order quantity against the instrument's rules. Returns the first problem found, if any. */
export function checkQuantity(quantity: number, rules: QuantityRules): QuantityProblem | undefined {
  if (!Number.isFinite(quantity)) return 'not-finite';
  if (quantity <= 0) return 'not-positive';
  const value = new Decimal(quantity);
  const min = new Decimal(rules.min);
  if (value.lt(min)) return 'below-min';
  if (rules.max !== undefined && value.gt(rules.max)) return 'above-max';
  if (!isWholeMultiple(value.minus(min), positiveStep(rules.step, 'step'))) return 'off-step';
  return undefined;
}

/**
 * Rounds a quantity onto the instrument's grid (`min + n * step`) and clamps
 * it to `[min, max]`. Rounds down by default, so the result never exceeds the input
 * unless the input is below `min`.
 */
export function roundQuantity(quantity: number, rules: QuantityRules, mode: RoundingMode = 'down'): number {
  const step = positiveStep(rules.step, 'step');
  const min = new Decimal(rules.min);
  let value = toDecimal(quantity, 'quantity')
    .minus(min)
    .div(step)
    .toDecimalPlaces(0, roundingFor[mode])
    .mul(step)
    .plus(min);
  if (value.lt(min)) value = min;
  if (rules.max !== undefined && value.gt(rules.max)) {
    const max = new Decimal(rules.max);
    value = max.minus(min).div(step).floor().mul(step).plus(min);
  }
  return value.toNumber();
}

/** Number of decimal places in `value`, e.g. 2 for `0.01`, 0 for `25`. */
export function decimalPlaces(value: number): number {
  return toDecimal(value).decimalPlaces();
}

/** Formats `value` with exactly `places` decimal places (halves round away from zero). */
export function formatDecimal(value: number, places: number): string {
  return toDecimal(value).toFixed(places);
}

/** Price distance from `from` to `to` measured in ticks (can be fractional or negative). */
export function ticksBetween(from: number, to: number, tickSize: number): number {
  return toDecimal(to, 'to')
    .minus(toDecimal(from, 'from'))
    .div(positiveStep(tickSize, 'tickSize'))
    .toNumber();
}

/** Decimal-exact sum, e.g. `addExact(0.1, 0.2) === 0.3`. */
export function addExact(...values: number[]): number {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(toDecimal(value));
  return total.toNumber();
}

/** Decimal-exact `a - b`. */
export function subtractExact(a: number, b: number): number {
  return toDecimal(a, 'a').minus(toDecimal(b, 'b')).toNumber();
}

/** Decimal-exact product. */
export function multiplyExact(...values: number[]): number {
  let total = new Decimal(1);
  for (const value of values) total = total.mul(toDecimal(value));
  return total.toNumber();
}

/** `a / b` computed with 34 significant digits, then converted to the nearest number. */
export function divideExact(a: number, b: number): number {
  const divisor = toDecimal(b, 'b');
  if (divisor.isZero()) throw new RangeError('Division by zero');
  return toDecimal(a, 'a').div(divisor).toNumber();
}
