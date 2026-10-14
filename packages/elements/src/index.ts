import { version } from '../package.json';

export const VERSION: string = version;

export { TdkWidgetElement, type ElementController, type TdkTheme } from './base';
export { TdkAccountPanelElement } from './account-panel';
export { TdkOrderTicketElement, type TicketInstrumentChoice } from './order-ticket';
export { TdkTradeButtonsElement } from './trade-buttons';
export { TdkNotificationsElement, type TdkToastPlacement } from './notifications';
export { COLOR_TOKENS, baseStyles, themeStyles } from './styles';
export type {
  TdkActionErrorDetail,
  TdkAmendDetail,
  TdkCancelOrderDetail,
  TdkClosePositionDetail,
  TdkDismissDetail,
  TdkEventMap,
  TdkEditExitsDetail,
  TdkNotificationDetail,
  TdkOrderAmendedDetail,
  TdkOrderErrorDetail,
  TdkOrderPlacedDetail,
  TdkReversePositionDetail,
  TdkTabChangeDetail,
} from './events';
