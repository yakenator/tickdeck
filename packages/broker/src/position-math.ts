import { addExact, divideExact, multiplyExact, sideSign, subtractExact, type Side } from '@tickdeck/core';

/** The netting-relevant part of a position. */
export interface NetPosition {
  side: Side;
  quantity: number;
  averagePrice: number;
}

export interface FillEffect {
  /** The position after the fill, or `undefined` when it is flat. */
  position: NetPosition | undefined;
  /** P&L realized by the part of the fill that reduced the position. */
  realizedPnl: number;
  /** Quantity of the old position that the fill closed. */
  closedQuantity: number;
  /** The fill closed the old position and opened one on the other side. */
  flipped: boolean;
}

/**
 * Applies a fill to a net position: same side adds at a weighted average
 * price, the opposite side reduces (realizing P&L), closes or flips it.
 * All arithmetic is decimal-exact.
 */
export function applyFillToPosition(
  position: NetPosition | undefined,
  side: Side,
  quantity: number,
  price: number,
  pointValue = 1,
): FillEffect {
  if (!position || position.quantity === 0) {
    return { position: { side, quantity, averagePrice: price }, realizedPnl: 0, closedQuantity: 0, flipped: false };
  }
  if (position.side === side) {
    const total = addExact(position.quantity, quantity);
    const cost = addExact(multiplyExact(position.averagePrice, position.quantity), multiplyExact(price, quantity));
    return {
      position: { side, quantity: total, averagePrice: divideExact(cost, total) },
      realizedPnl: 0,
      closedQuantity: 0,
      flipped: false,
    };
  }
  const closedQuantity = Math.min(position.quantity, quantity);
  const realizedPnl = multiplyExact(
    subtractExact(price, position.averagePrice),
    closedQuantity,
    sideSign(position.side),
    pointValue,
  );
  const remaining = subtractExact(position.quantity, quantity);
  if (remaining > 0) {
    return { position: { ...position, quantity: remaining }, realizedPnl, closedQuantity, flipped: false };
  }
  if (remaining === 0) return { position: undefined, realizedPnl, closedQuantity, flipped: false };
  return {
    position: { side, quantity: -remaining, averagePrice: price },
    realizedPnl,
    closedQuantity,
    flipped: true,
  };
}

/** Unrealized P&L of a position marked at `markPrice`. */
export function computeUnrealizedPnl(position: NetPosition, markPrice: number, pointValue = 1): number {
  return multiplyExact(
    subtractExact(markPrice, position.averagePrice),
    position.quantity,
    sideSign(position.side),
    pointValue,
  );
}
