import type {
  AccountPanelEvents,
  AccountTab,
  NotificationItem,
  OrderRow,
  OrderTicketEvents,
  PositionRow,
} from '@tickdeck/widgets-core';

type BrokerOrder = OrderRow['item'];
type BrokerPosition = PositionRow['item'];

/** `tdk-order-placed`: an order was sent and confirmed by the broker. */
export type TdkOrderPlacedDetail = OrderTicketEvents['placed'];
/** `tdk-order-amended`: a working order was changed. */
export type TdkOrderAmendedDetail = OrderTicketEvents['amended'];
/** `tdk-order-error`: checking, sending or changing an order failed. */
export interface TdkOrderErrorDetail {
  action: 'check' | 'submit' | 'amend' | 'trade';
  message: string;
  error: unknown;
}
/** `tdk-cancel-order` (cancelable): the user asked to cancel an order. */
export interface TdkCancelOrderDetail {
  order: BrokerOrder;
}
/** `tdk-amend`: the user wants to change a working order; open a ticket in amend mode. */
export interface TdkAmendDetail {
  order: BrokerOrder;
}
/** `tdk-close-position` (cancelable): the user asked to close a position, or `quantity` of it. */
export interface TdkClosePositionDetail {
  position: BrokerPosition;
  quantity?: number;
}
/** `tdk-reverse-position` (cancelable): the user asked to reverse a position. */
export interface TdkReversePositionDetail {
  position: BrokerPosition;
}
/** `tdk-edit-exits`: the user wants to change a position's take-profit or stop-loss. */
export interface TdkEditExitsDetail {
  position: BrokerPosition;
}
/** `tdk-action-error`: an account panel action failed. */
export type TdkActionErrorDetail = AccountPanelEvents['action-error'];
/** `tdk-tab-change`: the account panel switched tabs. */
export interface TdkTabChangeDetail {
  tab: AccountTab;
}
/** `tdk-notification`: a notification was shown. */
export interface TdkNotificationDetail {
  notification: NotificationItem;
}
/** `tdk-dismiss`: a toast left the screen. */
export interface TdkDismissDetail {
  notification: NotificationItem;
}

/** Every `tdk-*` event with its detail. The events bubble and cross shadow roots. */
export interface TdkEventMap {
  'tdk-order-placed': CustomEvent<TdkOrderPlacedDetail>;
  'tdk-order-amended': CustomEvent<TdkOrderAmendedDetail>;
  'tdk-order-error': CustomEvent<TdkOrderErrorDetail>;
  'tdk-cancel-order': CustomEvent<TdkCancelOrderDetail>;
  'tdk-amend': CustomEvent<TdkAmendDetail>;
  'tdk-close-position': CustomEvent<TdkClosePositionDetail>;
  'tdk-reverse-position': CustomEvent<TdkReversePositionDetail>;
  'tdk-edit-exits': CustomEvent<TdkEditExitsDetail>;
  'tdk-action-error': CustomEvent<TdkActionErrorDetail>;
  'tdk-tab-change': CustomEvent<TdkTabChangeDetail>;
  'tdk-notification': CustomEvent<TdkNotificationDetail>;
  'tdk-dismiss': CustomEvent<TdkDismissDetail>;
}

declare global {
  interface HTMLElementEventMap extends TdkEventMap {}
  interface DocumentEventMap extends TdkEventMap {}
}
