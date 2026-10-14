import type { BrokerSession } from '@tickdeck/broker';
import type { ChartView, TradingOverlay } from '@tickdeck/chart';
import type { MockFeed } from '@tickdeck/datafeed';

declare global {
  interface Window {
    /** For the browser console and the end-to-end tests. */
    playground?: { feed: MockFeed; session: BrokerSession; view?: ChartView; trading?: TradingOverlay };
  }
}
