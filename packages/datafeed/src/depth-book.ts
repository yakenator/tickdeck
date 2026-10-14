import type { DepthLevel, DepthUpdate } from './contract';

export interface DepthSides {
  bids: readonly DepthLevel[];
  asks: readonly DepthLevel[];
}

function applyLevels(side: Map<number, number>, levels: readonly DepthLevel[]): void {
  for (const level of levels) {
    if (level.size > 0) side.set(level.price, level.size);
    else side.delete(level.price);
  }
}

function sorted(side: Map<number, number>, descending: boolean): DepthLevel[] {
  const levels = [...side].map(([price, size]) => ({ price, size }));
  return levels.sort((a, b) => (descending ? b.price - a.price : a.price - b.price));
}

/** Keeps an order book from a stream of depth snapshots and deltas. */
export class DepthBook {
  readonly #bids = new Map<number, number>();
  readonly #asks = new Map<number, number>();

  apply(update: Pick<DepthUpdate, 'kind' | 'bids' | 'asks'>): void {
    if (update.kind === 'snapshot') this.clear();
    applyLevels(this.#bids, update.bids);
    applyLevels(this.#asks, update.asks);
  }

  clear(): void {
    this.#bids.clear();
    this.#asks.clear();
  }

  /** Bid levels, best (highest) first. */
  get bids(): DepthLevel[] {
    return sorted(this.#bids, true);
  }

  /** Ask levels, best (lowest) first. */
  get asks(): DepthLevel[] {
    return sorted(this.#asks, false);
  }

  get bestBid(): DepthLevel | undefined {
    return this.bids[0];
  }

  get bestAsk(): DepthLevel | undefined {
    return this.asks[0];
  }
}

function diffSide(previous: readonly DepthLevel[], next: readonly DepthLevel[]): DepthLevel[] {
  const before = new Map(previous.map((level) => [level.price, level.size]));
  const changes: DepthLevel[] = [];
  const seen = new Set<number>();
  for (const level of next) {
    seen.add(level.price);
    if (before.get(level.price) !== level.size) changes.push({ price: level.price, size: level.size });
  }
  for (const level of previous) {
    if (!seen.has(level.price)) changes.push({ price: level.price, size: 0 });
  }
  return changes;
}

/** Levels that turn `previous` into `next`, in delta form (`size: 0` removes a level). */
export function diffDepth(previous: DepthSides, next: DepthSides): { bids: DepthLevel[]; asks: DepthLevel[] } {
  return { bids: diffSide(previous.bids, next.bids), asks: diffSide(previous.asks, next.asks) };
}
