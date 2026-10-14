// Keeping trading lines on screen: the price span autoscale includes, and markers at the pane's edges for lines outside it.

/** The lowest and highest price among `lines`, which the price axis keeps in view while it scales itself. */
export function tradingPriceRange(lines: readonly { price: number }[]): { low: number; high: number } | undefined {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const { price } of lines) {
    if (!Number.isFinite(price)) continue;
    low = Math.min(low, price);
    high = Math.max(high, price);
  }
  return low <= high ? { low, high } : undefined;
}

export type ChartEdge = 'top' | 'bottom';

/** Where a line outside the visible prices is marked: at the `top` or `bottom` edge, `slot` labels in from it. */
export interface EdgeMarkerPlace {
  edge: ChartEdge;
  slot: number;
}

/**
 * Places markers for lines outside a pane `height` pixels tall, given each
 * line's pixel position `y` (0 is the top). Lines above go to the top edge and
 * lines below to the bottom edge, stacked inward in price order, so the
 * highest price is topmost and the lowest bottommost. Lines inside the pane
 * get no marker.
 */
export function placeEdgeMarkers(lines: readonly { id: string; y: number }[], height: number): Map<string, EdgeMarkerPlace> {
  const above = lines.filter((line) => line.y < 0).sort((a, b) => a.y - b.y);
  const below = lines.filter((line) => line.y > height).sort((a, b) => b.y - a.y);
  const places = new Map<string, EdgeMarkerPlace>();
  above.forEach((line, slot) => places.set(line.id, { edge: 'top', slot }));
  below.forEach((line, slot) => places.set(line.id, { edge: 'bottom', slot }));
  return places;
}
