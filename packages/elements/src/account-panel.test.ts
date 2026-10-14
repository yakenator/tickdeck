// @vitest-environment happy-dom
import { AccountPanelController } from '@tickdeck/widgets-core';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import type { TdkAmendDetail, TdkCancelOrderDetail, TdkClosePositionDetail } from './events';
import { ACME, key, query, rendered, setupTrading, shadow, text, type } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

async function mount() {
  const trading = await setupTrading();
  await trading.quote(100, 100.02);
  const panel = document.createElement('tdk-account-panel');
  panel.session = trading.session;
  panel.feed = trading.feed;
  document.body.append(panel);
  await rendered(panel);
  return { ...trading, panel };
}

const rows = (panel: HTMLElement) => [...shadow(panel).querySelectorAll('tr[part="row"]')];
const cells = (row: Element) => [...row.querySelectorAll('td[data-column]')].map((cell) => text(cell));

describe('<tdk-account-panel>', () => {
  it('renders the summary, tabs and empty states from the controller', async () => {
    const { panel } = await mount();
    expect(panel.activeController).toBeInstanceOf(AccountPanelController);
    expect(text(query(panel, '[part="summary"]'))).toBe(
      'Demo account USD Balance 100,000.00 Equity 100,000.00 Unrealized P&L 0.00 Realized P&L 0.00',
    );
    const tabs = [...shadow(panel).querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => [text(tab), tab.getAttribute('aria-selected'), tab.getAttribute('tabindex')])).toEqual([
      ['Orders0', 'true', '0'],
      ['Positions0', 'false', '-1'],
      ['Fills0', 'false', '-1'],
    ]);
    expect(text(query(panel, '[part="empty"]'))).toBe('No working orders');
    expect(query(panel, '[role="tabpanel"]').getAttribute('aria-labelledby')).toBe('tab-orders');
  });

  it('lists orders and cancels through a cancelable event', async () => {
    const { panel, session, settle } = await mount();
    const orderId = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 2, limitPrice: 99.5 });
    await settle();
    await rendered(panel);
    expect(rows(panel).map((row) => cells(row).slice(1))).toEqual([['ACME', 'Buy', 'Limit', '2', '99.50', '', 'GTC', 'Working']]);
    expect(cells(rows(panel)[0]!)[0]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    const cancel = query<HTMLButtonElement>(panel, '[part~="cancel-button"]');
    expect(cancel.getAttribute('aria-label')).toBe('Cancel order: Buy 2 ACME Limit 99.50');

    const requests: TdkCancelOrderDetail[] = [];
    panel.addEventListener('tdk-cancel-order', (event) => {
      requests.push(event.detail);
      event.preventDefault();
    }, { once: true });
    cancel.click();
    await settle();
    expect(requests.map((detail) => detail.order.id)).toEqual([orderId]);
    expect(session.getOrder(orderId)?.state).toBe('open');

    cancel.click();
    await settle();
    await rendered(panel);
    expect(session.getOrder(orderId)?.state).toBe('cancelled');
    expect(text(query(panel, '[part="empty"]'))).toBe('No working orders');

    const all = [...shadow(panel).querySelectorAll('[part="filter"] button')].find((button) => text(button) === 'All') as HTMLButtonElement;
    all.click();
    await rendered(panel);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(cells(rows(panel)[0]!).at(-1)).toBe('Cancelled');
  });

  it('asks for amendments with an event', async () => {
    const { panel, session, settle } = await mount();
    const orderId = await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 1, limitPrice: 101 });
    await settle();
    await rendered(panel);
    const amends: TdkAmendDetail[] = [];
    document.addEventListener('tdk-amend', (event) => amends.push(event.detail), { once: true });
    query<HTMLButtonElement>(panel, '[part~="amend-button"]').click();
    expect(amends.map((detail) => detail.order.id)).toEqual([orderId]);
  });

  it('switches tabs with the arrow keys and sorts by column', async () => {
    const { panel, session, quote } = await mount();
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 3 });
    await quote(40_000, 40_001, 'MOCK:BTCUSD');
    await session.submitOrder({ instrument: 'MOCK:BTCUSD', side: 'sell', kind: 'market', quantity: 0.5 });
    await quote(100.1, 100.12);
    await rendered(panel);

    const orders = query(panel, '#tab-orders');
    orders.focus();
    key(orders, 'ArrowRight');
    await rendered(panel);
    expect(query(panel, '#tab-positions').getAttribute('aria-selected')).toBe('true');
    expect(shadow(panel).activeElement?.id).toBe('tab-positions');
    expect(rows(panel).map((row) => cells(row).slice(0, 3))).toEqual([
      ['ACME', 'Long', '3'],
      ['BTCUSD', 'Short', '0.500'],
    ]);

    const quantityHeader = [...shadow(panel).querySelectorAll('th')].find((th) => text(th).startsWith('Quantity'))!;
    quantityHeader.querySelector('button')!.click();
    await rendered(panel);
    expect(quantityHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(rows(panel).map((row) => cells(row)[0])).toEqual(['BTCUSD', 'ACME']);
    quantityHeader.querySelector('button')!.click();
    await rendered(panel);
    expect(quantityHeader.getAttribute('aria-sort')).toBe('descending');
    expect(rows(panel).map((row) => cells(row)[0])).toEqual(['ACME', 'BTCUSD']);

    key(query(panel, '#tab-positions'), 'End');
    await rendered(panel);
    expect(query(panel, '#tab-fills').getAttribute('aria-selected')).toBe('true');
    expect(rows(panel)).toHaveLength(2);
  });

  it('closes part of a position from the keyboard', async () => {
    const { panel, session, settle } = await mount();
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 10 });
    await settle();
    panel.tab = 'positions';
    await rendered(panel);
    const closes: TdkClosePositionDetail[] = [];
    panel.addEventListener('tdk-close-position', (event) => closes.push(event.detail));

    query<HTMLButtonElement>(panel, '[part~="close-button"]').click();
    await rendered(panel);
    const input = query<HTMLInputElement>(panel, '#close-quantity');
    expect(input.value).toBe('10');
    expect(shadow(panel).activeElement).toBe(input);

    key(input, 'Escape');
    await rendered(panel);
    expect(shadow(panel).querySelector('#close-quantity')).toBeNull();

    query<HTMLButtonElement>(panel, '[part~="close-button"]').click();
    await rendered(panel);
    const again = query<HTMLInputElement>(panel, '#close-quantity');
    type(again, '12');
    await rendered(panel);
    expect(again.getAttribute('aria-invalid')).toBe('true');
    expect(text(query(panel, '#close-error'))).toBe('At most 10');
    type(again, '4');
    await rendered(panel);
    query<HTMLFormElement>(panel, '.close-form').requestSubmit();
    await settle();
    await rendered(panel);
    expect(closes.map((detail) => detail.quantity)).toEqual([4]);
    expect(session.positions[0]).toMatchObject({ quantity: 6 });
    expect(cells(rows(panel)[0]!).slice(0, 3)).toEqual(['ACME', 'Long', '6']);
  });

  it('renders a controller passed in directly, with a theme', async () => {
    const { session } = await setupTrading();
    const controller = new AccountPanelController({ session }, { tab: 'fills' });
    const panel = document.createElement('tdk-account-panel');
    panel.controller = controller;
    panel.theme = 'dark';
    document.body.append(panel);
    await rendered(panel);
    expect(panel.activeController).toBe(controller);
    expect(panel.getAttribute('theme')).toBe('dark');
    expect(text(query(panel, '[part="empty"]'))).toBe('No fills yet');
    panel.remove();
    await rendered(panel);
    expect(controller.disposed).toBe(false);
  });
});
