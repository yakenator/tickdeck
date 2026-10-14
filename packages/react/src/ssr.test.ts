// @vitest-environment node
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons } from './index';

const feed = new MockFeed({ autoTick: false });
const session = new BrokerSession(new MockBroker({ feed }));

describe('server-side rendering', () => {
  it('renders simple props as attributes and leaves rich ones for the browser', () => {
    const html = renderToString(
      createElement(
        'main',
        null,
        createElement(TdkTradeButtons, { session, feed, instrument: 'MOCK:ACME', quantity: 10, confirm: true, theme: 'dark' }),
        createElement(TdkOrderTicket, {
          session,
          feed,
          className: 'ticket',
          instrument: 'MOCK:ACME',
          kind: 'limit',
          side: 'sell',
          checkOrders: false,
          exitMode: 'ticks',
          timeZone: 'America/New_York',
          instruments: ['MOCK:ACME', 'MOCK:ES'],
          onOrderPlaced: () => {},
        }),
        createElement(TdkAccountPanel, { session, tab: 'positions', orderFilter: 'all' }),
        createElement(TdkNotifications, { session, placement: 'bottom-end', hideLog: true, maxToasts: 3 }),
      ),
    );
    expect(html).toContain('<tdk-trade-buttons instrument="MOCK:ACME" quantity="10" confirm="" theme="dark"></tdk-trade-buttons>');
    expect(html).toContain(
      '<tdk-order-ticket class="ticket" instrument="MOCK:ACME" kind="limit" side="sell" exit-mode="ticks" time-zone="America/New_York"></tdk-order-ticket>',
    );
    expect(html).toContain('<tdk-account-panel tab="positions" order-filter="all"></tdk-account-panel>');
    expect(html).toContain('<tdk-notifications placement="bottom-end" hide-log="" max-toasts="3"></tdk-notifications>');
    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('check-orders');
  });
});
