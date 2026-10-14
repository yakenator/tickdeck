import { describe, expect, it } from 'vitest';
import {
  addExact,
  checkQuantity,
  decimalPlaces,
  divideExact,
  formatDecimal,
  isOnTick,
  multiplyExact,
  roundQuantity,
  roundToStep,
  roundToTick,
  subtractExact,
  ticksBetween,
} from './decimal';

describe('price rounding', () => {
  it('rounds to the tick without binary noise', () => {
    expect(roundToTick(101.2345, 0.01)).toBe(101.23);
    expect(roundToTick(101.235, 0.01)).toBe(101.24);
    expect(roundToTick(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToTick(1.08437, 0.00005)).toBe(1.08435);
    expect(roundToTick(60_012.3, 0.5)).toBe(60_012.5);
    expect(roundToTick(4_517.13, 0.25)).toBe(4_517.25);
  });

  it('honours rounding modes, including for negative values', () => {
    expect(roundToTick(10.07, 0.05, 'down')).toBe(10.05);
    expect(roundToTick(10.01, 0.05, 'up')).toBe(10.05);
    expect(roundToTick(-1.25, 0.5)).toBe(-1.5);
    expect(roundToTick(-1.2, 0.5, 'down')).toBe(-1.5);
    expect(roundToTick(-1.2, 0.5, 'up')).toBe(-1);
    expect(roundToStep(7, 5)).toBe(5);
  });

  it('checks tick alignment while ignoring floating-point noise', () => {
    expect(isOnTick(101.25, 0.25)).toBe(true);
    expect(isOnTick(0.1 + 0.2, 0.1)).toBe(true);
    expect(isOnTick(101.26, 0.25)).toBe(false);
    expect(isOnTick(1.08436, 0.00005)).toBe(false);
  });

  it('rejects invalid steps', () => {
    expect(() => roundToTick(1, 0)).toThrow(RangeError);
    expect(() => roundToTick(Number.NaN, 0.01)).toThrow(RangeError);
  });

  it('measures and formats', () => {
    expect(ticksBetween(99.5, 101, 0.01)).toBe(150);
    expect(ticksBetween(101, 99.5, 0.25)).toBe(-6);
    expect(decimalPlaces(0.00005)).toBe(5);
    expect(decimalPlaces(25)).toBe(0);
    expect(formatDecimal(1.005, 2)).toBe('1.01');
    expect(formatDecimal(3, 2)).toBe('3.00');
  });
});

describe('quantity rules', () => {
  const lots = { min: 0.01, max: 100, step: 0.01 };
  const shares = { min: 1, step: 1 };
  const fxLots = { min: 1000, max: 1_000_000, step: 1000 };

  it('accepts quantities on the grid', () => {
    expect(checkQuantity(0.07, lots)).toBeUndefined();
    expect(checkQuantity(0.1 + 0.2, lots)).toBeUndefined();
    expect(checkQuantity(25, shares)).toBeUndefined();
    expect(checkQuantity(3000, fxLots)).toBeUndefined();
  });

  it('reports the first problem', () => {
    expect(checkQuantity(Number.POSITIVE_INFINITY, shares)).toBe('not-finite');
    expect(checkQuantity(0, shares)).toBe('not-positive');
    expect(checkQuantity(0.005, lots)).toBe('below-min');
    expect(checkQuantity(100.01, lots)).toBe('above-max');
    expect(checkQuantity(2.5, shares)).toBe('off-step');
    expect(checkQuantity(1500, fxLots)).toBe('off-step');
  });

  it('counts steps from the minimum', () => {
    expect(checkQuantity(1.5, { min: 0.5, step: 1 })).toBeUndefined();
    expect(checkQuantity(2, { min: 0.5, step: 1 })).toBe('off-step');
  });

  it('rounds and clamps quantities onto the grid', () => {
    expect(roundQuantity(2.7, shares)).toBe(2);
    expect(roundQuantity(2.2, shares, 'up')).toBe(3);
    expect(roundQuantity(0.004, lots)).toBe(0.01);
    expect(roundQuantity(250, lots)).toBe(100);
    expect(roundQuantity(2.9, { min: 0.5, step: 1 })).toBe(2.5);
    expect(roundQuantity(1_234_567, fxLots)).toBe(1_000_000);
  });
});

describe('exact arithmetic', () => {
  it('avoids binary floating-point error', () => {
    expect(addExact(0.1, 0.2)).toBe(0.3);
    expect(addExact(100_000, 15.7, -0.3)).toBe(100_015.4);
    expect(subtractExact(101.05, 99.48)).toBe(1.57);
    expect(multiplyExact(1.57, 10)).toBe(15.7);
    expect(multiplyExact(0.00012, 100_000, 1)).toBe(12);
    expect(divideExact(1, 4)).toBe(0.25);
    expect(divideExact(99.5 * 10 + 100 * 5, 15)).toBeCloseTo(99.666666666, 8);
  });

  it('refuses division by zero', () => {
    expect(() => divideExact(1, 0)).toThrow(RangeError);
  });
});
