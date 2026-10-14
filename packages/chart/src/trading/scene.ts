import {
  computeUnrealizedPnl,
  isWorkingState,
  type BrokerOrder,
  type BrokerPosition,
  type ExitRole,
  type Fill,
  type ResolvedBrokerCapabilities,
} from '@tickdeck/broker';
import {
  divideExact,
  multiplyExact,
  oppositeSide,
  sideSign,
  subtractExact,
  ticksBetween,
  type Bar,
  type Instrument,
  type OrderKind,
  type Side,
} from '@tickdeck/core';
import { formatMoney, formatPercent, formatTicks } from '../price';

/** What a line shows: a working order, a protective exit or a position. */
export type TradingLineKind = 'order' | 'take-profit' | 'stop-loss' | 'position';

/** Which visibility toggle a line follows. Exits follow what they protect. */
export type TradingLineGroup = 'orders' | 'positions';

export interface TradingVisibility {
  /** Working orders and the exits attached to them. */
  orders: boolean;
  /** Positions and their exits. */
  positions: boolean;
  fills: boolean;
}

/** What dragging or removing a line acts on. */
export type TradingLineTarget =
  /** A price field of a working order (including an exit order that is shown on its own). */
  | { type: 'order'; orderId: string; field: 'limitPrice' | 'stopPrice' }
  /** The take-profit or stop-loss requested on a working entry order. */
  | { type: 'order-exit'; entryOrderId: string; role: ExitRole; exitOrderId?: string }
  /** The take-profit or stop-loss protecting a position. */
  | { type: 'position-exit'; positionId: string; role: ExitRole; exitOrderId?: string }
  | { type: 'position'; positionId: string };

/** Unrealized profit or loss of a position line. Fields are unset when no mark price is known. */
export interface PositionPnl {
  /** In the instrument's currency. */
  money?: number;
  /** Distance from the average price in ticks, positive when in profit. */
  ticks?: number;
  /** Distance from the average price in percent, positive when in profit. */
  percent?: number;
  currency?: string;
}

/** One horizontal line of the trading overlay. */
export interface TradingLine {
  /** Stable key, e.g. `order:ord-1` or `exit:position:pos-2:take-profit`. */
  id: string;
  kind: TradingLineKind;
  group: TradingLineGroup;
  /** Side of the order, or of the position for position lines. */
  side: Side;
  price: number;
  quantity: number;
  /** Short description, e.g. `BUY LMT 10`, `TP 10` or `LONG 10`. */
  label: string;
  target: TradingLineTarget;
  /** The price can be changed by dragging the line. */
  draggable: boolean;
  /** The line has a cancel (orders, exits) or close (positions) button. */
  removable: boolean;
  /** A change made from the chart awaits the broker's confirmation. */
  pending: boolean;
  pnl?: PositionPnl;
}

/** A small marker at the time and price of a fill. */
export interface FillMarker {
  id: string;
  fillId: string;
  /** Open time of the bar the fill belongs to. */
  time: number;
  price: number;
  side: Side;
  quantity: number;
}

export interface TradingScene {
  lines: TradingLine[];
  fills: FillMarker[];
}

/** A change made from the chart that the broker has not confirmed yet. */
export interface TradingLineEdit {
  /** The price the line was dragged to. */
  price?: number;
  /** A cancel or close was sent. */
  removing?: boolean;
}

export interface TradingSceneInput {
  instrument: Instrument;
  orders: readonly BrokerOrder[];
  positions: readonly BrokerPosition[];
  fills: readonly Fill[];
  capabilities: Pick<ResolvedBrokerCapabilities, 'amendOrders' | 'positionExits'>;
  /** Default: everything visible. */
  visibility?: TradingVisibility;
  /** Unconfirmed changes by line id. */
  edits?: ReadonlyMap<string, TradingLineEdit>;
  /** Loaded bars (oldest first), to place fill markers and mark positions without a broker price. */
  bars?: readonly Bar[];
  /** Most recent fills shown. Default 50. */
  maxFills?: number;
}

const SIDE_LABEL: Record<Side, string> = { buy: 'BUY', sell: 'SELL' };
const POSITION_LABEL: Record<Side, string> = { buy: 'LONG', sell: 'SHORT' };
const KIND_LABEL: Record<OrderKind, string> = { market: 'MKT', limit: 'LMT', stop: 'STP', 'stop-limit': 'STP LMT' };
const ROLE_LABEL: Record<ExitRole, string> = { 'take-profit': 'TP', 'stop-loss': 'SL' };
const ROLES: readonly ExitRole[] = ['take-profit', 'stop-loss'];
const EXIT_FIELD = { 'take-profit': 'takeProfit', 'stop-loss': 'stopLoss' } as const;
const EXIT_PRICE_FIELD = { 'take-profit': 'limitPrice', 'stop-loss': 'stopPrice' } as const;

export const ALL_VISIBLE: Readonly<TradingVisibility> = { orders: true, positions: true, fills: true };

const quantityText = (quantity: number): string => String(quantity);

/** Remaining (unfilled) quantity of an order. */
const remainingOf = (order: BrokerOrder): number => subtractExact(order.quantity, order.filledQuantity);

/** Price of a protective exit order: the limit of a take-profit, the stop of a stop-loss. */
function exitPrice(order: BrokerOrder, role: ExitRole): number | undefined {
  return order[EXIT_PRICE_FIELD[role]] ?? order.limitPrice ?? order.stopPrice;
}

function isExitOrder(order: BrokerOrder): boolean {
  return order.exitRole !== undefined && order.parent !== undefined;
}

/**
 * Open time of the bar a fill belongs to: the last loaded bar that opened at
 * or before `time`. `undefined` when the fill is older than the loaded bars.
 */
export function fillBarTime(time: number, bars: readonly Bar[]): number | undefined {
  const first = bars[0];
  if (!first || time < first.time) return undefined;
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((bars[middle] as Bar).time <= time) low = middle;
    else high = middle - 1;
  }
  return (bars[low] as Bar).time;
}

/** Unrealized P&L of a position, from the broker when it reports one, otherwise marked at `fallbackMark`. */
export function positionPnl(position: BrokerPosition, instrument: Instrument, fallbackMark?: number): PositionPnl {
  const mark = position.lastPrice ?? fallbackMark;
  const pnl: PositionPnl = { currency: instrument.currency };
  pnl.money =
    position.unrealizedPnl ??
    (mark === undefined ? undefined : computeUnrealizedPnl(position, mark, instrument.pointValue ?? 1));
  if (mark !== undefined) {
    const sign = sideSign(position.side);
    pnl.ticks = multiplyExact(ticksBetween(position.averagePrice, mark, instrument.tickSize), sign);
    if (position.averagePrice !== 0) {
      pnl.percent = divideExact(multiplyExact(subtractExact(mark, position.averagePrice), 100, sign), position.averagePrice);
    }
  }
  return pnl;
}

/** Units shown in a position's P&L label. */
export type PnlUnit = 'money' | 'ticks' | 'percent';

/**
 * P&L text of a position line, e.g. `+125.50 USD · +12 ticks`. Units without
 * a value are left out; `undefined` when none has one.
 */
export function formatPositionPnl(
  pnl: PositionPnl,
  units: readonly PnlUnit[] = ['money'],
  money: (value: number, currency?: string) => string = formatMoney,
): string | undefined {
  const parts: string[] = [];
  for (const unit of units) {
    if (unit === 'money' && pnl.money !== undefined) parts.push(money(pnl.money, pnl.currency));
    if (unit === 'ticks' && pnl.ticks !== undefined) parts.push(formatTicks(pnl.ticks));
    if (unit === 'percent' && pnl.percent !== undefined) parts.push(formatPercent(pnl.percent));
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
}

function orderLines(order: BrokerOrder, capabilities: TradingSceneInput['capabilities']): TradingLine[] {
  const quantity = remainingOf(order);
  const base = {
    kind: 'order' as const,
    group: 'orders' as const,
    side: order.side,
    quantity,
    draggable: capabilities.amendOrders,
    pending: false,
  };
  const label = `${SIDE_LABEL[order.side]} ${KIND_LABEL[order.kind]} ${quantityText(quantity)}`;
  const lines: TradingLine[] = [];
  if ((order.kind === 'stop' || order.kind === 'stop-limit') && order.stopPrice !== undefined) {
    lines.push({
      ...base,
      id: `order:${order.id}`,
      price: order.stopPrice,
      label,
      target: { type: 'order', orderId: order.id, field: 'stopPrice' },
      removable: true,
    });
  }
  if ((order.kind === 'limit' || order.kind === 'stop-limit') && order.limitPrice !== undefined) {
    const secondary = order.kind === 'stop-limit';
    lines.push({
      ...base,
      id: secondary ? `order:${order.id}:limit` : `order:${order.id}`,
      price: order.limitPrice,
      label: secondary ? `LMT ${quantityText(quantity)}` : label,
      target: { type: 'order', orderId: order.id, field: 'limitPrice' },
      removable: !secondary,
    });
  }
  return lines;
}

/**
 * Maps broker state to the lines and markers the chart draws for one
 * instrument. Pure: the same input always gives the same scene.
 *
 * - Working orders get a line at their limit or stop price (stop-limit
 *   orders get both); market orders have no price and no line.
 * - Take-profit and stop-loss levels of working entry orders and of
 *   positions get their own lines, whether the broker reports them as
 *   fields or as exit orders.
 * - Positions get a line at their average price with unrealized P&L.
 * - The most recent fills get markers on the bar they happened in.
 */
export function buildTradingScene(input: TradingSceneInput): TradingScene {
  const { instrument, capabilities } = input;
  const visibility = input.visibility ?? ALL_VISIBLE;
  const orders = input.orders.filter((order) => order.instrument === instrument.id && isWorkingState(order.state));
  const exits = orders.filter(isExitOrder);
  const used = new Set<string>();
  const exitOf = (kind: 'order' | 'position', parentId: string, role: ExitRole) => {
    const found = exits.find(
      (order) => order.exitRole === role && order.parent?.kind === kind && order.parent.id === parentId,
    );
    if (found) used.add(found.id);
    return found;
  };
  const lastClose = input.bars?.[input.bars.length - 1]?.close;
  const lines: TradingLine[] = [];

  for (const position of input.positions) {
    if (position.instrument !== instrument.id || !(position.quantity > 0)) continue;
    lines.push({
      id: `position:${position.id}`,
      kind: 'position',
      group: 'positions',
      side: position.side,
      price: position.averagePrice,
      quantity: position.quantity,
      label: `${POSITION_LABEL[position.side]} ${quantityText(position.quantity)}`,
      target: { type: 'position', positionId: position.id },
      draggable: false,
      removable: true,
      pending: false,
      pnl: positionPnl(position, instrument, lastClose),
    });
    for (const role of ROLES) {
      const exit = exitOf('position', position.id, role);
      const price = exit ? exitPrice(exit, role) : position[EXIT_FIELD[role]];
      if (price === undefined) continue;
      const editable = capabilities.positionExits || (exit !== undefined && capabilities.amendOrders);
      const quantity = exit ? remainingOf(exit) : position.quantity;
      lines.push({
        id: `exit:position:${position.id}:${role}`,
        kind: role,
        group: 'positions',
        side: oppositeSide(position.side),
        price,
        quantity,
        label: `${ROLE_LABEL[role]} ${quantityText(quantity)}`,
        target: { type: 'position-exit', positionId: position.id, role, exitOrderId: exit?.id },
        draggable: editable,
        removable: capabilities.positionExits || exit !== undefined,
        pending: false,
      });
    }
  }

  for (const order of orders) {
    if (isExitOrder(order)) continue;
    lines.push(...orderLines(order, capabilities));
    for (const role of ROLES) {
      const exit = exitOf('order', order.id, role);
      const price = exit ? exitPrice(exit, role) : order[EXIT_FIELD[role]];
      if (price === undefined) continue;
      const quantity = exit ? remainingOf(exit) : remainingOf(order);
      lines.push({
        id: `exit:order:${order.id}:${role}`,
        kind: role,
        group: 'orders',
        side: oppositeSide(order.side),
        price,
        quantity,
        label: `${ROLE_LABEL[role]} ${quantityText(quantity)}`,
        target: { type: 'order-exit', entryOrderId: order.id, role, exitOrderId: exit?.id },
        draggable: capabilities.amendOrders,
        removable: capabilities.amendOrders,
        pending: false,
      });
    }
  }

  // Exit orders whose entry or position is unknown are shown as plain orders.
  for (const exit of exits) {
    if (used.has(exit.id)) continue;
    const role = exit.exitRole as ExitRole;
    const price = exitPrice(exit, role);
    if (price === undefined) continue;
    const quantity = remainingOf(exit);
    lines.push({
      id: `order:${exit.id}`,
      kind: role,
      group: exit.parent?.kind === 'position' ? 'positions' : 'orders',
      side: exit.side,
      price,
      quantity,
      label: `${ROLE_LABEL[role]} ${quantityText(quantity)}`,
      target: { type: 'order', orderId: exit.id, field: EXIT_PRICE_FIELD[role] },
      draggable: capabilities.amendOrders,
      removable: true,
      pending: false,
    });
  }

  const visible = lines.filter((line) => visibility[line.group]);
  for (const line of visible) {
    const edit = input.edits?.get(line.id);
    if (!edit) continue;
    if (edit.price !== undefined) line.price = edit.price;
    line.pending = true;
  }

  return { lines: visible, fills: visibility.fills ? fillMarkers(input) : [] };
}

function fillMarkers(input: TradingSceneInput): FillMarker[] {
  const bars = input.bars ?? [];
  // Newest first (later fills win ties), so the most recent ones survive the limit.
  const fills = input.fills
    .map((fill, index) => ({ fill, index }))
    .filter(({ fill }) => fill.instrument === input.instrument.id)
    .sort((a, b) => b.fill.time - a.fill.time || b.index - a.index)
    .slice(0, input.maxFills ?? 50)
    .map(({ fill }) => fill);
  const markers: FillMarker[] = [];
  for (const fill of fills) {
    const time = fillBarTime(fill.time, bars);
    if (time === undefined) continue;
    markers.push({ id: `fill:${fill.id}`, fillId: fill.id, time, price: fill.price, side: fill.side, quantity: fill.quantity });
  }
  return markers.reverse();
}
