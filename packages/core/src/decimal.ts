import type { QuantityRules } from './types';

/**
 * An exact decimal, `coefficient / 10^scale`. Numbers are read through their
 * shortest round-trip text (`String(0.1)` is `"0.1"`), so a price typed or
 * received as `0.1` is exactly one tenth here, not its binary approximation.
 */
interface Exact {
  coefficient: bigint;
  scale: number;
}

/** A quotient of two exact decimals, `numerator / denominator` with a positive denominator. */
interface Ratio {
  numerator: bigint;
  denominator: bigint;
}

// Differences smaller than a billionth of a step count as binary floating-point noise.
const NOISE_FACTOR = 1_000_000_000n;
// Significant digits kept when a quotient becomes a number.
const QUOTIENT_DIGITS = 34;

const NUMBER_TEXT = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

const powers: bigint[] = [];
function pow10(exponent: number): bigint {
  return (powers[exponent] ??= 10n ** BigInt(exponent));
}

function exact(value: number, name = 'value'): Exact {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number, got ${value}`);
  const [, sign, integer, fraction = '', exponent = '0'] = NUMBER_TEXT.exec(String(value)) as RegExpExecArray;
  let digits = integer + fraction;
  let scale = fraction.length - Number(exponent);
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  return { coefficient: BigInt(sign + digits), scale };
}

function positiveStep(step: number, name: string): Exact {
  const decimal = exact(step, name);
  if (decimal.coefficient <= 0n) throw new RangeError(`${name} must be positive, got ${step}`);
  return decimal;
}

function rescale(value: Exact, scale: number): bigint {
  return value.coefficient * pow10(scale - value.scale);
}

function plus(a: Exact, b: Exact): Exact {
  const scale = Math.max(a.scale, b.scale);
  return { coefficient: rescale(a, scale) + rescale(b, scale), scale };
}

function minus(a: Exact, b: Exact): Exact {
  return plus(a, { coefficient: -b.coefficient, scale: b.scale });
}

function times(a: Exact, b: Exact): Exact {
  return { coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale };
}

function compare(a: Exact, b: Exact): number {
  const scale = Math.max(a.scale, b.scale);
  const difference = rescale(a, scale) - rescale(b, scale);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

function divide(a: Exact, b: Exact): Ratio {
  let numerator = a.coefficient * pow10(b.scale);
  let denominator = b.coefficient * pow10(a.scale);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return { numerator, denominator };
}

/**
 * - `nearest`: to the closest multiple, halves away from zero.
 * - `down`: towards negative infinity.
 * - `up`: towards positive infinity.
 */
export type RoundingMode = 'nearest' | 'down' | 'up';

/** Rounds a quotient to a whole number. */
function roundRatio({ numerator, denominator }: Ratio, mode: RoundingMode): bigint {
  const quotient = numerator / denominator; // truncated towards zero
  const remainder = numerator % denominator; // has the numerator's sign
  if (remainder === 0n) return quotient;
  const negative = numerator < 0n;
  switch (mode) {
    case 'down':
      return negative ? quotient - 1n : quotient;
    case 'up':
      return negative ? quotient : quotient + 1n;
    case 'nearest': {
      const twice = 2n * (negative ? -remainder : remainder);
      if (twice < denominator) return quotient;
      return negative ? quotient - 1n : quotient + 1n;
    }
  }
}

function toNumber(value: Exact): number {
  return Number(`${value.coefficient}e-${value.scale}`);
}

/** A quotient as the nearest number, through 34 significant decimal digits (halves away from zero). */
function ratioToNumber(ratio: Ratio): number {
  if (ratio.numerator === 0n) return 0;
  const magnitude = ratio.numerator < 0n ? -ratio.numerator : ratio.numerator;
  const integerDigits = magnitude.toString().length - ratio.denominator.toString().length + 1;
  const scale = Math.max(0, QUOTIENT_DIGITS - integerDigits);
  const scaled = roundRatio({ numerator: ratio.numerator * pow10(scale), denominator: ratio.denominator }, 'nearest');
  return toNumber({ coefficient: scaled, scale });
}

function roundToMultiple(value: Exact, step: Exact, mode: RoundingMode): Exact {
  return times({ coefficient: roundRatio(divide(value, step), mode), scale: 0 }, step);
}

function isWholeMultiple(value: Exact, step: Exact): boolean {
  const ratio = divide(value, step);
  const off = ratio.numerator - roundRatio(ratio, 'nearest') * ratio.denominator;
  return (off < 0n ? -off : off) * NOISE_FACTOR <= ratio.denominator;
}

/** Rounds `value` to a multiple of `step`, counting from zero. */
export function roundToStep(value: number, step: number, mode: RoundingMode = 'nearest'): number {
  return toNumber(roundToMultiple(exact(value), positiveStep(step, 'step'), mode));
}

/** Rounds a price to the instrument's tick size. */
export function roundToTick(price: number, tickSize: number, mode: RoundingMode = 'nearest'): number {
  return roundToStep(price, tickSize, mode);
}

/** Whether `price` is a multiple of `tickSize` (ignoring floating-point noise). */
export function isOnTick(price: number, tickSize: number): boolean {
  return isWholeMultiple(exact(price, 'price'), positiveStep(tickSize, 'tickSize'));
}

export type QuantityProblem = 'not-finite' | 'not-positive' | 'below-min' | 'above-max' | 'off-step';

/** Checks an order quantity against the instrument's rules. Returns the first problem found, if any. */
export function checkQuantity(quantity: number, rules: QuantityRules): QuantityProblem | undefined {
  if (!Number.isFinite(quantity)) return 'not-finite';
  if (quantity <= 0) return 'not-positive';
  const value = exact(quantity);
  const min = exact(rules.min, 'min');
  if (compare(value, min) < 0) return 'below-min';
  if (rules.max !== undefined && compare(value, exact(rules.max, 'max')) > 0) return 'above-max';
  if (!isWholeMultiple(minus(value, min), positiveStep(rules.step, 'step'))) return 'off-step';
  return undefined;
}

/**
 * Rounds a quantity onto the instrument's grid (`min + n * step`) and clamps
 * it to `[min, max]`. Rounds down by default, so the result never exceeds the input
 * unless the input is below `min`.
 */
export function roundQuantity(quantity: number, rules: QuantityRules, mode: RoundingMode = 'down'): number {
  const step = positiveStep(rules.step, 'step');
  const min = exact(rules.min, 'min');
  let value = plus(roundToMultiple(minus(exact(quantity, 'quantity'), min), step, mode), min);
  if (compare(value, min) < 0) value = min;
  if (rules.max !== undefined) {
    const max = exact(rules.max, 'max');
    if (compare(value, max) > 0) value = plus(roundToMultiple(minus(max, min), step, 'down'), min);
  }
  return toNumber(value);
}

/** Number of decimal places in `value`, e.g. 2 for `0.01`, 0 for `25`. */
export function decimalPlaces(value: number): number {
  let { coefficient, scale } = exact(value);
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  return scale;
}

/** Formats `value` with exactly `places` decimal places (halves round away from zero). */
export function formatDecimal(value: number, places: number): string {
  if (!Number.isInteger(places) || places < 0) throw new RangeError(`places must be a whole number of at least 0, got ${places}`);
  const decimal = exact(value);
  const coefficient =
    decimal.scale <= places
      ? rescale(decimal, places)
      : roundRatio({ numerator: decimal.coefficient, denominator: pow10(decimal.scale - places) }, 'nearest');
  // Like Number#toFixed, a negative value keeps its sign even when it rounds to zero.
  const sign = decimal.coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(places + 1, '0');
  const integer = digits.slice(0, digits.length - places);
  return places === 0 ? `${sign}${integer}` : `${sign}${integer}.${digits.slice(-places)}`;
}

/** Price distance from `from` to `to` measured in ticks (can be fractional or negative). */
export function ticksBetween(from: number, to: number, tickSize: number): number {
  return ratioToNumber(divide(minus(exact(to, 'to'), exact(from, 'from')), positiveStep(tickSize, 'tickSize')));
}

/** Decimal-exact sum, e.g. `addExact(0.1, 0.2) === 0.3`. */
export function addExact(...values: number[]): number {
  let total: Exact = { coefficient: 0n, scale: 0 };
  for (const value of values) total = plus(total, exact(value));
  return toNumber(total);
}

/** Decimal-exact `a - b`. */
export function subtractExact(a: number, b: number): number {
  return toNumber(minus(exact(a, 'a'), exact(b, 'b')));
}

/** Decimal-exact product. */
export function multiplyExact(...values: number[]): number {
  let total: Exact = { coefficient: 1n, scale: 0 };
  for (const value of values) total = times(total, exact(value));
  return toNumber(total);
}

/** `a / b` computed with 34 significant digits, then converted to the nearest number. */
export function divideExact(a: number, b: number): number {
  const divisor = exact(b, 'b');
  if (divisor.coefficient === 0n) throw new RangeError('Division by zero');
  return ratioToNumber(divide(exact(a, 'a'), divisor));
}
