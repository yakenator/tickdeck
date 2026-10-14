import { describe, expect, it } from 'vitest';
import { applyFillToPosition, computeUnrealizedPnl } from './position-math';

describe('position netting', () => {
  it('opens a position from flat', () => {
    expect(applyFillToPosition(undefined, 'buy', 10, 99.5)).toEqual({
      position: { side: 'buy', quantity: 10, averagePrice: 99.5 },
      realizedPnl: 0,
      closedQuantity: 0,
      flipped: false,
    });
  });

  it('adds at a weighted average price', () => {
    const effect = applyFillToPosition({ side: 'buy', quantity: 10, averagePrice: 100.1 }, 'buy', 30, 100.3);
    expect(effect.position).toEqual({ side: 'buy', quantity: 40, averagePrice: 100.25 });
  });

  it('realizes P&L when reducing and closing, exactly', () => {
    const long = { side: 'buy' as const, quantity: 10, averagePrice: 99.48 };
    expect(applyFillToPosition(long, 'sell', 4, 101.05)).toEqual({
      position: { side: 'buy', quantity: 6, averagePrice: 99.48 },
      realizedPnl: 6.28,
      closedQuantity: 4,
      flipped: false,
    });
    expect(applyFillToPosition(long, 'sell', 10, 101.05).realizedPnl).toBe(15.7);
    expect(applyFillToPosition(long, 'sell', 10, 101.05).position).toBeUndefined();
  });

  it('flips through zero and applies the point value', () => {
    const short = { side: 'sell' as const, quantity: 2, averagePrice: 4800.25 };
    const effect = applyFillToPosition(short, 'buy', 5, 4790.5, 50);
    expect(effect.realizedPnl).toBe(975);
    expect(effect.flipped).toBe(true);
    expect(effect.position).toEqual({ side: 'buy', quantity: 3, averagePrice: 4790.5 });
  });

  it('marks unrealized P&L by side', () => {
    expect(computeUnrealizedPnl({ side: 'buy', quantity: 10, averagePrice: 99.5 }, 99.4)).toBe(-1);
    expect(computeUnrealizedPnl({ side: 'sell', quantity: 3000, averagePrice: 1.08437 }, 1.08421)).toBe(0.48);
  });
});
