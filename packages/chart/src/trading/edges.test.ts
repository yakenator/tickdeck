import { describe, expect, it } from 'vitest';
import { placeEdgeMarkers, tradingPriceRange } from './edges';

describe('tradingPriceRange', () => {
  it('spans every line price', () => {
    expect(tradingPriceRange([{ price: 101 }, { price: 98.5 }, { price: 99.5 }])).toEqual({ low: 98.5, high: 101 });
    expect(tradingPriceRange([{ price: 42 }])).toEqual({ low: 42, high: 42 });
  });

  it('is undefined without lines or prices', () => {
    expect(tradingPriceRange([])).toBeUndefined();
    expect(tradingPriceRange([{ price: Number.NaN }])).toBeUndefined();
  });
});

describe('placeEdgeMarkers', () => {
  it('marks lines outside the pane at the nearer edge, in price order', () => {
    const places = placeEdgeMarkers(
      [
        { id: 'tp', y: -40 },
        { id: 'far-tp', y: -300 },
        { id: 'order', y: 120 },
        { id: 'sl', y: 520 },
        { id: 'edge', y: 0 },
      ],
      400,
    );
    expect(Object.fromEntries(places)).toEqual({
      'far-tp': { edge: 'top', slot: 0 },
      tp: { edge: 'top', slot: 1 },
      sl: { edge: 'bottom', slot: 0 },
    });
  });

  it('places nothing when every line is visible', () => {
    expect(placeEdgeMarkers([{ id: 'a', y: 0 }, { id: 'b', y: 400 }], 400).size).toBe(0);
  });
});
