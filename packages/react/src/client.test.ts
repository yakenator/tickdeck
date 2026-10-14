// @vitest-environment happy-dom
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TdkOrderTicket, TdkTradeButtons, type TdkOrderPlacedDetail } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const feed = new MockFeed({ autoTick: false });
const session = new BrokerSession(new MockBroker({ feed }));
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function container(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

describe('in the browser', () => {
  it('sets every prop as a property with its type, and keeps the attributes in step', async () => {
    const host = container();
    root = createRoot(host);
    const render = (element: ReactElement) => act(() => root!.render(element));
    const onOrderPlaced = vi.fn<(event: CustomEvent<TdkOrderPlacedDetail>) => void>();
    render(createElement(TdkTradeButtons, { session, feed, instrument: 'MOCK:ACME', quantity: 10, confirm: true, timeZone: 'Asia/Tokyo', onOrderPlaced }));
    const buttons = host.querySelector('tdk-trade-buttons')!;
    expect([buttons.session, buttons.feed, buttons.instrument, buttons.quantity, buttons.confirm, buttons.timeZone]).toEqual([
      session,
      feed,
      'MOCK:ACME',
      10,
      true,
      'Asia/Tokyo',
    ]);
    await buttons.updateComplete;
    expect(buttons.hasAttribute('confirm')).toBe(true);

    render(createElement(TdkTradeButtons, { session, feed, instrument: 'MOCK:ES', quantity: 2, confirm: false }));
    await buttons.updateComplete;
    expect([buttons.instrument, buttons.quantity, buttons.confirm, buttons.hasAttribute('confirm')]).toEqual(['MOCK:ES', 2, false, false]);
    expect(buttons.timeZone).toBeUndefined();

    buttons.dispatchEvent(new CustomEvent('tdk-order-placed', { detail: { orderId: 'o1' } }));
    expect(onOrderPlaced).not.toHaveBeenCalled();
  });

  it('hydrates server HTML without mismatches', () => {
    const element = createElement(TdkOrderTicket, { session, feed, instrument: 'MOCK:ACME', kind: 'limit', checkOrders: true, timeZone: 'UTC' });
    const host = container();
    host.innerHTML = renderToString(element);
    expect(host.innerHTML).toBe('<tdk-order-ticket instrument="MOCK:ACME" kind="limit" check-orders="" time-zone="UTC"></tdk-order-ticket>');
    const errors = vi.spyOn(console, 'error');
    act(() => {
      root = hydrateRoot(host, element);
    });
    expect(errors).not.toHaveBeenCalled();
    const ticket = host.querySelector('tdk-order-ticket')!;
    expect([ticket.session, ticket.kind, ticket.checkOrders, ticket.timeZone]).toEqual([session, 'limit', true, 'UTC']);
  });
});
