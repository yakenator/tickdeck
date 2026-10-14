import { TdkAccountPanelElement } from './account-panel';
import { TdkNotificationsElement } from './notifications';
import { TdkOrderTicketElement } from './order-ticket';
import { TdkPlaceholderElement } from './placeholder';
import { TdkTradeButtonsElement } from './trade-buttons';

const elements: Record<string, CustomElementConstructor> = {
  'tdk-account-panel': TdkAccountPanelElement,
  'tdk-order-ticket': TdkOrderTicketElement,
  'tdk-trade-buttons': TdkTradeButtonsElement,
  'tdk-notifications': TdkNotificationsElement,
  'tdk-placeholder': TdkPlaceholderElement,
};

for (const [tag, element] of Object.entries(elements)) {
  if (!customElements.get(tag)) customElements.define(tag, element);
}
