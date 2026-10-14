import type { OrderKind, QuantityRules, Side, TimeInForce } from '@tickdeck/core';

/**
 * Lifecycle state of an order.
 *
 * Working states: `pending` (sent, not yet accepted), `held` (accepted but
 * inactive, such as a protective exit waiting for its entry to fill) and
 * `open` (working at the venue, possibly partly filled).
 * Final states: `filled`, `cancelled`, `rejected`.
 */
export type OrderState = 'pending' | 'held' | 'open' | 'filled' | 'cancelled' | 'rejected';

/** Role of a protective exit order. */
export type ExitRole = 'take-profit' | 'stop-loss';

/** What a protective exit order is attached to. */
export interface OrderParent {
  kind: 'order' | 'position';
  id: string;
}

/** A new order as entered by the user. */
export interface OrderRequest {
  instrument: string;
  side: Side;
  kind: OrderKind;
  quantity: number;
  /** Required for `limit` and `stop-limit`. */
  limitPrice?: number;
  /** Required for `stop` and `stop-limit`. */
  stopPrice?: number;
  timeInForce?: TimeInForce;
  /** Expiry for `gtd`, UTC epoch milliseconds. */
  expiresAt?: number;
  /** Take-profit price; creates a protective exit that activates when this order fills. */
  takeProfit?: number;
  /** Stop-loss price; creates a protective exit that activates when this order fills. */
  stopLoss?: number;
  /** The order may only reduce an existing position, never open or increase one. */
  reduceOnly?: boolean;
  /** Integrator data. tickdeck passes it through untouched. */
  meta?: unknown;
}

/** An order as reported by the broker. */
export interface BrokerOrder {
  id: string;
  accountId?: string;
  instrument: string;
  side: Side;
  kind: OrderKind;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  expiresAt?: number;
  state: OrderState;
  /** Quantity filled so far. Never decreases. */
  filledQuantity: number;
  averageFillPrice?: number;
  /** Requested exits of an entry order. */
  takeProfit?: number;
  stopLoss?: number;
  /** Set on protective exit orders. */
  parent?: OrderParent;
  exitRole?: ExitRole;
  reduceOnly?: boolean;
  /** Broker message, such as a rejection reason. */
  message?: string;
  /** Time of the last change, UTC epoch milliseconds. */
  updatedAt?: number;
  meta?: unknown;
}

/**
 * Changes to a working order. Omitted fields stay as they are. For exits,
 * `null` removes the exit.
 */
export interface OrderAmendment {
  quantity?: number;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  expiresAt?: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
}

/** Take-profit and stop-loss levels. `undefined` keeps the current level, `null` removes it. */
export interface ProtectiveExits {
  takeProfit?: number | null;
  stopLoss?: number | null;
}

/** A net position in one instrument. */
export interface BrokerPosition {
  id: string;
  accountId?: string;
  instrument: string;
  /** `buy` for long, `sell` for short. */
  side: Side;
  /** Always positive while open. An update with `0` means the position closed. */
  quantity: number;
  averagePrice: number;
  /** Current protective exit levels. */
  takeProfit?: number;
  stopLoss?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  /** Price used for `unrealizedPnl`. */
  lastPrice?: number;
  updatedAt?: number;
  meta?: unknown;
}

/** One execution (trade) of an order. */
export interface Fill {
  id: string;
  orderId?: string;
  positionId?: string;
  instrument: string;
  side: Side;
  price: number;
  quantity: number;
  /** UTC epoch milliseconds. */
  time: number;
  commission?: number;
  /** Profit or loss realized by this fill, if it reduced a position. */
  realizedPnl?: number;
  meta?: unknown;
}

/** Profit and loss of one position, pushed as prices move. */
export interface PnlUpdate {
  positionId: string;
  unrealizedPnl: number;
  lastPrice?: number;
}

export interface AccountBalance {
  accountId: string;
  currency: string;
  /** Cash balance including realized P&L. */
  balance: number;
  /** `balance + unrealizedPnl`. */
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marginUsed?: number;
  marginAvailable?: number;
}

export interface BrokerAccount {
  id: string;
  name: string;
  currency: string;
  kind?: 'live' | 'demo';
}

export type BrokerConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface BrokerConnection {
  state: BrokerConnectionState;
  message?: string;
}

/** A message for the user, shown as a toast and kept in the notification log. */
export interface BrokerNotice {
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  orderId?: string;
  positionId?: string;
}

/** Trading constraints for one instrument. */
export interface TradingRules {
  instrument: string;
  /** False when the instrument cannot be traded on the active account. */
  tradable: boolean;
  /** Why the instrument is not tradable. */
  reason?: string;
  tickSize: number;
  pricePrecision?: number;
  quantity: QuantityRules;
  /** Order kinds allowed for this instrument, when narrower than the broker's. */
  orderKinds?: readonly OrderKind[];
  timeInForce?: readonly TimeInForce[];
  /** Value of a 1.0 price move for one unit of quantity. Defaults to 1. */
  pointValue?: number;
  currency?: string;
  /** Initial margin as a fraction of notional value. */
  marginRate?: number;
}

/** Result of checking an order before it is sent. */
export interface OrderCheck {
  /** Pass this to `submitOrder` to confirm the checked order. */
  confirmationToken?: string;
  estimates?: {
    /** Notional value of the order. */
    cost?: number;
    commission?: number;
    margin?: number;
  };
  /** Shown to the user, who may still submit. */
  warnings?: readonly string[];
  /** The order cannot be submitted as it is. */
  errors?: readonly string[];
}

/** What the broker supports. Unset fields take the defaults noted on each. */
export interface BrokerCapabilities {
  /** Default `['market', 'limit', 'stop']`. */
  orderKinds?: readonly OrderKind[];
  /** Default `['day', 'gtc']`. */
  timeInForce?: readonly TimeInForce[];
  /** Take-profit and stop-loss on entry orders. Default false. */
  orderExits?: boolean;
  /** Take-profit and stop-loss on positions (`setPositionExits`). Default false. */
  positionExits?: boolean;
  /** Working orders can be amended. Default true. */
  amendOrders?: boolean;
  /** Native `closePosition`. Default false. */
  closePosition?: boolean;
  /** `closePosition` accepts a partial quantity. Default false. */
  partialClose?: boolean;
  /** Native `reversePosition`. Default false. */
  reversePosition?: boolean;
  /** `checkOrder` is implemented and should run before every submit. Default false. */
  orderCheck?: boolean;
  /** More than one account can be selected. Default false. */
  multipleAccounts?: boolean;
  /**
   * Let tickdeck emulate closing and reversing with plain market orders when
   * there is no native support. Default true.
   */
  emulation?: boolean;
}

export type ResolvedBrokerCapabilities = Required<BrokerCapabilities>;

/** Full state, pushed when the connector lost track of individual changes. */
export interface ResyncSnapshot {
  orders?: readonly BrokerOrder[];
  positions?: readonly BrokerPosition[];
  fills?: readonly Fill[];
  balance?: AccountBalance;
}
