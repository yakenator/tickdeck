import { version } from '../package.json';

export const VERSION: string = version;

export type { ActionResult, WidgetAvailability, WidgetContext, WidgetFeed } from './context';
export { WidgetController } from './controller';
export {
  formatAmount,
  formatInputNumber,
  formatTimeOfDay,
  moneyPrecision,
  parseInputNumber,
  type AmountFormatOptions,
} from './format';
export {
  InstrumentFormat,
  InstrumentResolver,
  getInstrumentResolver,
  toTradableInstrument,
  type TradableInstrument,
} from './instrument';
export { QuoteWatcher, toQuoteDisplay, type QuoteDisplay } from './quotes';
export { OrderRejectedError, awaitAcknowledgement, describeTradingError, placeOrder, runAcknowledged } from './actions';
export {
  EXIT_ROLE_LABELS,
  ORDER_KIND_LABELS,
  ORDER_STATE_LABELS,
  POSITION_SIDE_LABELS,
  SIDE_LABELS,
  TIME_IN_FORCE_DESCRIPTIONS,
  TIME_IN_FORCE_LABELS,
} from './labels';
export {
  AccountPanelController,
  describeOrder,
  type AccountPanelEvents,
  type AccountPanelOptions,
  type AccountPanelState,
  type AccountSummary,
  type AccountTab,
  type CellTone,
  type CloseDraft,
  type FillRow,
  type OrderFilter,
  type OrderRow,
  type PanelAction,
  type PanelColumn,
  type PanelRow,
  type PanelStatus,
  type PositionRow,
  type SortDirection,
  type SortOrder,
  type SummaryItem,
} from './account-panel';
export {
  OrderTicketController,
  type EstimateItem,
  type ExitDraft,
  type ExitField,
  type ExitInputMode,
  type OrderTicketEvents,
  type OrderTicketOptions,
  type OrderTicketState,
  type TicketEditable,
  type TicketField,
  type TicketPhase,
  type TicketReview,
} from './order-ticket';
export {
  TradeButtonsController,
  type TradeButtonsEvents,
  type TradeButtonsOptions,
  type TradeButtonsState,
  type TradeSideView,
} from './trade-buttons';
export {
  NotificationCenter,
  type NotificationCenterEvents,
  type NotificationCenterOptions,
  type NotificationCenterState,
  type NotificationInput,
  type NotificationItem,
  type NotificationLevel,
  type NotificationSource,
} from './notifications';
