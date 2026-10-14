import type { Emitter } from '@tickdeck/core';
import type {
  AccountBalance,
  BrokerAccount,
  BrokerCapabilities,
  BrokerConnection,
  BrokerNotice,
  BrokerOrder,
  BrokerPosition,
  Fill,
  OrderAmendment,
  OrderCheck,
  OrderRequest,
  PnlUpdate,
  ProtectiveExits,
  ResolvedBrokerCapabilities,
  ResyncSnapshot,
  TradingRules,
} from './types';

/**
 * Changes the connector pushes to tickdeck. Each order, position and fill
 * update carries the full object (it replaces the previous one with the same id).
 */
export interface BrokerUpdates {
  order: BrokerOrder;
  /** A position with `quantity: 0` is closed. */
  position: BrokerPosition;
  fill: Fill;
  pnl: PnlUpdate;
  balance: AccountBalance;
  connection: BrokerConnection;
  /** The active account changed; tickdeck reloads accounts, orders, positions and fills. */
  account: { accountId: string };
  notice: BrokerNotice;
  /** Replaces tickdeck's view wholesale. Use only when individual updates were lost. */
  resync: ResyncSnapshot;
}

/** The channel the connector pushes updates through: `sink.emit('order', order)`. */
export type BrokerUpdateSink = Pick<Emitter<BrokerUpdates>, 'emit'>;

/** One update as a tagged value. */
export type BrokerUpdate = { [K in keyof BrokerUpdates]: { type: K; payload: BrokerUpdates[K] } }[keyof BrokerUpdates];

/**
 * The broker adapter the integrator implements. tickdeck sends requests
 * through it; the connector reports every resulting change through the sink
 * it received in `connect`.
 *
 * Every action (`submitOrder`, `amendOrder`, `cancelOrder`, `closePosition`,
 * `reversePosition`, `setPositionExits`) must be followed by a matching
 * update within the acknowledgement deadline (10 seconds by default):
 *
 * - submit: an `order` update for the new id in a state other than `pending`;
 * - amend: any `order` update for that order;
 * - cancel: an `order` update for that order in a final state;
 * - close and reverse: a `position` update for that position;
 * - set exits: a `position` update for that position or an `order` update for one of its exits.
 *
 * The integrator's backend is the source of truth. tickdeck keeps only a
 * derived in-memory view.
 */
export interface BrokerConnector {
  /** Called once. Keep the sink and push every change through it. */
  connect(sink: BrokerUpdateSink): Promise<void>;
  disconnect?(): Promise<void>;
  getCapabilities(): Promise<BrokerCapabilities>;
  /** tickdeck shows trading controls only while the state is `connected`. */
  getConnection(): Promise<BrokerConnection>;
  listAccounts(): Promise<BrokerAccount[]>;
  /** Id of the active account. */
  getActiveAccount(): Promise<string>;
  switchAccount?(accountId: string): Promise<void>;
  /** Working orders and recent final ones on the active account. */
  listOrders(): Promise<BrokerOrder[]>;
  /** Open positions on the active account. */
  listPositions(): Promise<BrokerPosition[]>;
  /** Recent fills, optionally for one instrument. */
  listFills(instrument?: string): Promise<Fill[]>;
  getBalance?(): Promise<AccountBalance>;
  /** Trading constraints for one instrument on the active account. */
  getTradingRules(instrument: string): Promise<TradingRules>;
  /**
   * Sends a new order and resolves with its id once the broker has taken it.
   * Validation failures may reject, or resolve and then push a `rejected` order.
   * @param confirmationToken From `checkOrder`, when the order was checked first.
   */
  submitOrder(request: OrderRequest, confirmationToken?: string): Promise<string>;
  amendOrder(orderId: string, changes: OrderAmendment, confirmationToken?: string): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
  /** Closes all of a position, or `quantity` of it when partial close is supported. */
  closePosition?(positionId: string, quantity?: number): Promise<void>;
  /** Turns a position into one of the same size on the other side. */
  reversePosition?(positionId: string): Promise<void>;
  setPositionExits?(positionId: string, exits: ProtectiveExits): Promise<void>;
  /** Estimates costs and finds problems before an order is sent. */
  checkOrder?(request: OrderRequest): Promise<OrderCheck>;
}

export function resolveBrokerCapabilities(capabilities: BrokerCapabilities): ResolvedBrokerCapabilities {
  return {
    orderKinds: capabilities.orderKinds ?? ['market', 'limit', 'stop'],
    timeInForce: capabilities.timeInForce ?? ['day', 'gtc'],
    orderExits: capabilities.orderExits ?? false,
    positionExits: capabilities.positionExits ?? false,
    amendOrders: capabilities.amendOrders ?? true,
    closePosition: capabilities.closePosition ?? false,
    partialClose: capabilities.partialClose ?? false,
    reversePosition: capabilities.reversePosition ?? false,
    orderCheck: capabilities.orderCheck ?? false,
    multipleAccounts: capabilities.multipleAccounts ?? false,
    emulation: capabilities.emulation ?? true,
  };
}
