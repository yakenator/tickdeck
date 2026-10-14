import { describe, expect, it } from 'vitest';
import { DepthBook, diffDepth } from './depth-book';

describe('DepthBook', () => {
  it('applies a snapshot, then deltas with removals', () => {
    const book = new DepthBook();
    book.apply({
      kind: 'snapshot',
      bids: [
        { price: 99.9, size: 5 },
        { price: 100, size: 3 },
      ],
      asks: [
        { price: 100.2, size: 4 },
        { price: 100.1, size: 2 },
      ],
    });
    book.apply({
      kind: 'delta',
      bids: [
        { price: 100, size: 0 },
        { price: 99.8, size: 7 },
      ],
      asks: [{ price: 100.1, size: 6 }],
    });

    expect(book.bids).toEqual([
      { price: 99.9, size: 5 },
      { price: 99.8, size: 7 },
    ]);
    expect(book.asks).toEqual([
      { price: 100.1, size: 6 },
      { price: 100.2, size: 4 },
    ]);
    expect(book.bestBid?.price).toBe(99.9);
    expect(book.bestAsk?.price).toBe(100.1);
  });

  it('replaces everything on a new snapshot', () => {
    const book = new DepthBook();
    book.apply({ kind: 'snapshot', bids: [{ price: 1, size: 1 }], asks: [] });
    book.apply({ kind: 'snapshot', bids: [{ price: 2, size: 1 }], asks: [] });
    expect(book.bids).toEqual([{ price: 2, size: 1 }]);
  });
});

describe('diffDepth', () => {
  it('lists changed, added and removed levels', () => {
    const previous = {
      bids: [
        { price: 100, size: 3 },
        { price: 99.9, size: 5 },
      ],
      asks: [{ price: 100.1, size: 2 }],
    };
    const next = {
      bids: [
        { price: 100, size: 4 },
        { price: 99.8, size: 1 },
      ],
      asks: [{ price: 100.1, size: 2 }],
    };

    const delta = diffDepth(previous, next);

    expect(delta.bids).toEqual([
      { price: 100, size: 4 },
      { price: 99.8, size: 1 },
      { price: 99.9, size: 0 },
    ]);
    expect(delta.asks).toEqual([]);

    const book = new DepthBook();
    book.apply({ kind: 'snapshot', ...previous });
    book.apply({ kind: 'delta', ...delta });
    expect(book.bids).toEqual(next.bids);
  });
});
