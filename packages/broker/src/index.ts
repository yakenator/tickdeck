import { version } from '../package.json';

export const VERSION: string = version;

export type {
  AccountBalance,
  BrokerAccount,
  BrokerCapabilities,
  BrokerConnection,
  BrokerConnectionState,
  BrokerNotice,
  BrokerOrder,
  BrokerPosition,
  ExitRole,
  Fill,
  OrderAmendment,
  OrderCheck,
  OrderParent,
  OrderRequest,
  OrderState,
  PnlUpdate,
  ProtectiveExits,
  ResolvedBrokerCapabilities,
  ResyncSnapshot,
  TradingRules,
} from './types';
export {
  resolveBrokerCapabilities,
  type BrokerConnector,
  type BrokerUpdate,
  type BrokerUpdates,
  type BrokerUpdateSink,
} from './contract';
export {
  FINAL_ORDER_STATES,
  WORKING_ORDER_STATES,
  canTransition,
  checkOrderUpdate,
  isFinalState,
  isWorkingState,
  type OrderUpdateProblem,
  type OrderUpdateProblemCode,
} from './order-state';
export {
  AckTimeoutError,
  AckWatchdog,
  DEFAULT_ACK_TIMEOUT_MS,
  type AckExpectation,
  type AckOutcome,
  type AckWatchdogOptions,
  type BrokerAction,
  type PendingAck,
} from './watchdog';
export { applyFillToPosition, computeUnrealizedPnl, type FillEffect, type NetPosition } from './position-math';
export {
  BrokerError,
  BrokerSession,
  type BrokerErrorCode,
  type BrokerSessionEvents,
  type BrokerSessionOptions,
} from './session';
export { MockBroker, type MockBrokerFeed, type MockBrokerOptions } from './mock/mock-broker';
