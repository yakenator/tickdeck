import { describe, expect, it } from 'vitest';
import { formatMoney, formatPercent, formatPrice, formatTicks, priceDecimals, snapOrderPrice, snapPrice } from './price';

describe('snapPrice', () => {
  it('rounds to the nearest tick without float noise', () => {
    expect(snapPrice(101.2345, 0.01)).toBe(101.23);
    expect(snapPrice(101.235, 0.01)).toBe(101.24);
    expect(snapPrice(4517.13, 0.25)).toBe(4517.25);
    expect(snapPrice(4517.12, 0.25)).toBe(4517);
    expect(snapPrice(1.0812345, 0.00001)).toBe(1.08123);
    expect(snapPrice(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapPrice(40_123.26, 0.5)).toBe(40_123.5);
  });

  it('keeps order prices at one tick or more', () => {
    expect(snapOrderPrice(-3, 0.25)).toBe(0.25);
    expect(snapOrderPrice(0.04, 0.25)).toBe(0.25);
    expect(snapOrderPrice(99.996, 0.01)).toBe(100);
  });
});

describe('price formatting', () => {
  it('uses the precision, widened by the tick size', () => {
    expect(formatPrice(101.5, { tickSize: 0.01, pricePrecision: 2 })).toBe('101.50');
    expect(formatPrice(4517.25, { tickSize: 0.25, pricePrecision: 2 })).toBe('4517.25');
    expect(formatPrice(1.08, { tickSize: 0.00001, pricePrecision: 5 })).toBe('1.08000');
    expect(priceDecimals({ tickSize: 0.005, pricePrecision: 2 })).toBe(3);
  });

  it('formats money, ticks and percentages with signs', () => {
    expect(formatMoney(125.5, 'USD')).toBe('+125.50 USD');
    expect(formatMoney(-3.456)).toBe('-3.46');
    expect(formatMoney(-0.001, 'USD')).toBe('0.00 USD');
    expect(formatTicks(12)).toBe('+12 ticks');
    expect(formatTicks(-1)).toBe('-1 tick');
    expect(formatTicks(2.5)).toBe('+2.5 ticks');
    expect(formatTicks(0)).toBe('0 ticks');
    expect(formatPercent(0.8549)).toBe('+0.85%');
    expect(formatPercent(-1.2)).toBe('-1.20%');
  });
});
