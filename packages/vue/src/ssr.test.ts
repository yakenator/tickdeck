// @vitest-environment node
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { describe, expect, it } from 'vitest';
import { createSSRApp, h, markRaw } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons } from './index';

const feed = markRaw(new MockFeed({ autoTick: false }));
const session = markRaw(new BrokerSession(new MockBroker({ feed })));

describe('server-side rendering', () => {
  it('renders simple props as attributes and leaves rich ones for the browser', async () => {
    const app = createSSRApp({
      render: () =>
        h('main', [
          h(TdkTradeButtons, { session, feed, instrument: 'MOCK:ACME', quantity: 10, confirm: true, theme: 'dark' }),
          h(TdkOrderTicket, {
            session,
            feed,
            class: 'ticket',
            instrument: 'MOCK:ACME',
            kind: 'limit',
            side: 'sell',
            checkOrders: false,
            exitMode: 'ticks',
            timeZone: 'America/New_York',
            instruments: ['MOCK:ACME', 'MOCK:ES'],
            onOrderPlaced: () => {},
          }),
          h(TdkAccountPanel, { session, tab: 'positions', orderFilter: 'all' }),
          h(TdkNotifications, { session, placement: 'bottom-end', hideLog: true, maxToasts: 3 }),
        ]),
    });
    const html = await renderToString(app);
    expect(html).toContain('<tdk-trade-buttons theme="dark" instrument="MOCK:ACME" quantity="10" confirm></tdk-trade-buttons>');
    expect(html).toContain(
      '<tdk-order-ticket class="ticket" time-zone="America/New_York" instrument="MOCK:ACME" side="sell" kind="limit" exit-mode="ticks"></tdk-order-ticket>',
    );
    expect(html).toContain('<tdk-account-panel tab="positions" order-filter="all"></tdk-account-panel>');
    expect(html).toContain('<tdk-notifications placement="bottom-end" hide-log max-toasts="3"></tdk-notifications>');
    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('check-orders');
  });
});
