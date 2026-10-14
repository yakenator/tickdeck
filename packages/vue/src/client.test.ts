// @vitest-environment happy-dom
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, createSSRApp, h, markRaw, nextTick, ref, type App } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { TdkOrderTicket, TdkTradeButtons } from './index';

const feed = markRaw(new MockFeed({ autoTick: false }));
const session = markRaw(new BrokerSession(new MockBroker({ feed })));
let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
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
    const props = ref<Record<string, unknown>>({ instrument: 'MOCK:ACME', quantity: 10, confirm: true, timeZone: 'Asia/Tokyo' });
    app = createApp({ render: () => h(TdkTradeButtons, { session, feed, ...props.value }) });
    app.mount(host);
    const buttons = host.querySelector('tdk-trade-buttons')!;
    expect([buttons.session, buttons.feed, buttons.instrument, buttons.quantity, buttons.confirm, buttons.timeZone]).toEqual([
      session,
      feed,
      'MOCK:ACME',
      10,
      true,
      'Asia/Tokyo',
    ]);
    expect([buttons.getAttribute('confirm'), buttons.getAttribute('time-zone')]).toEqual(['', 'Asia/Tokyo']);

    props.value = { instrument: 'MOCK:ES', quantity: 2, confirm: false };
    await nextTick();
    await buttons.updateComplete;
    expect([buttons.instrument, buttons.quantity, buttons.confirm, buttons.hasAttribute('confirm'), buttons.hasAttribute('time-zone')]).toEqual([
      'MOCK:ES',
      2,
      false,
      false,
      false,
    ]);
  });

  it('hydrates server HTML without mismatches', async () => {
    const render = () => h(TdkOrderTicket, { session, feed, instrument: 'MOCK:ACME', kind: 'limit', checkOrders: true, timeZone: 'UTC' });
    const host = container();
    host.innerHTML = await renderToString(createSSRApp({ render }));
    expect(host.innerHTML).toBe('<tdk-order-ticket time-zone="UTC" instrument="MOCK:ACME" kind="limit" check-orders=""></tdk-order-ticket>');
    const warnings = vi.spyOn(console, 'warn');
    const errors = vi.spyOn(console, 'error');
    app = createSSRApp({ render });
    app.mount(host);
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    const ticket = host.querySelector('tdk-order-ticket')!;
    expect([ticket.session, ticket.kind, ticket.checkOrders, ticket.timeZone]).toEqual([session, 'limit', true, 'UTC']);
  });

  it('passes other attributes and listeners on to the element', async () => {
    const host = container();
    const onClick = vi.fn();
    const placed = vi.fn();
    app = createApp({
      render: () => h(TdkTradeButtons, { session, feed, id: 'buttons', class: 'side', style: { order: '2' }, 'aria-describedby': 'help', onClick, onOrderPlaced: placed }),
    });
    app.mount(host);
    const buttons = host.querySelector('tdk-trade-buttons')!;
    expect([buttons.id, buttons.className, buttons.style.order, buttons.getAttribute('aria-describedby')]).toEqual(['buttons', 'side', '2', 'help']);
    buttons.click();
    buttons.dispatchEvent(new CustomEvent('tdk-order-placed', { detail: { orderId: 'o1' } }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(placed).toHaveBeenCalledWith({ orderId: 'o1' });
  });
});
