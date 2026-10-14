// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import type { TdkOrderAmendedDetail, TdkOrderPlacedDetail } from './events';
import { ACME, key, query, rendered, setupTrading, shadow, text, type } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(attributes: Record<string, string> = {}) {
  const trading = await setupTrading();
  await trading.quote(100, 100.02);
  const ticket = document.createElement('tdk-order-ticket');
  ticket.setAttribute('instrument', ACME);
  for (const [name, value] of Object.entries(attributes)) ticket.setAttribute(name, value);
  ticket.session = trading.session;
  ticket.feed = trading.feed;
  document.body.append(ticket);
  await rendered(ticket);
  await ticket.activeController!.ready;
  await rendered(ticket);
  return { ...trading, ticket };
}

const radio = (ticket: HTMLElement, group: string, value: string) =>
  query<HTMLButtonElement>(ticket, `[part~="${group}"] [data-value="${value}"]`);

describe('<tdk-order-ticket>', () => {
  it('shows the live quote and builds a limit order with exits', async () => {
    const { ticket, session, settle } = await mount({ quantity: '10' });
    expect(text(query(ticket, '[part="quote"]'))).toBe('Bid100.00 Spread0.02 Ask100.02');
    expect(text(query(ticket, '[part="instrument"]'))).toBe('ACME');
    expect(radio(ticket, 'side', 'buy').getAttribute('aria-checked')).toBe('true');

    radio(ticket, 'kind', 'limit').click();
    await rendered(ticket);
    const limit = query<HTMLInputElement>(ticket, '#limitPrice');
    expect(limit.value).toBe('100.00');

    // Typing keeps the text as entered; an off-tick price is flagged on the field.
    type(limit, '99.555');
    await rendered(ticket);
    expect(limit.value).toBe('99.555');
    expect(limit.getAttribute('aria-invalid')).toBe('true');
    expect(text(query(ticket, '#limitPrice-error'))).toBe('Use multiples of the tick size 0.01 (nearest 99.56)');
    key(limit, 'ArrowDown');
    await rendered(ticket);
    expect(limit.value).toBe('99.55');
    expect(limit.getAttribute('aria-invalid')).toBe('false');
    type(limit, '99.5');
    await rendered(ticket);

    const exits = shadow(ticket).querySelectorAll<HTMLInputElement>('[part="exits"] input[type="checkbox"]');
    exits[0]!.click();
    exits[1]!.click();
    await rendered(ticket);
    radio(ticket, 'exit-mode', 'ticks').click();
    await rendered(ticket);
    type(query<HTMLInputElement>(ticket, '#takeProfit-ticks'), '150');
    type(query<HTMLInputElement>(ticket, '#stopLoss-price'), '98.5');
    await rendered(ticket);
    expect(text(query(ticket, '[part~="take-profit"] [part="hint"]'))).toBe('at 101.00');
    expect(text(query(ticket, '[part~="stop-loss"] [part="hint"]'))).toBe('100 ticks');
    expect(text(query(ticket, '[part="estimates"]'))).toBe(
      'Notional995.00 USDRisk to stop-loss10.00 USDReward to take-profit15.00 USD',
    );

    const submit = query<HTMLButtonElement>(ticket, '[part~="submit-button"]');
    expect(text(submit)).toBe('Buy 10 ACME limit 99.50');
    const placed: TdkOrderPlacedDetail[] = [];
    ticket.addEventListener('tdk-order-placed', (event) => placed.push(event.detail));
    query<HTMLFormElement>(ticket, 'form').requestSubmit();
    await settle();
    await rendered(ticket);

    expect(placed.map((detail) => detail.request)).toEqual([
      {
        instrument: ACME,
        side: 'buy',
        kind: 'limit',
        quantity: 10,
        limitPrice: 99.5,
        timeInForce: 'gtc',
        takeProfit: 101,
        stopLoss: 98.5,
      },
    ]);
    expect(session.getOrder(placed[0]!.orderId)).toMatchObject({ state: 'open', takeProfit: 101, stopLoss: 98.5 });
    expect(text(query(ticket, '[part="result"]'))).toBe('Order placed: Buy 10 ACME limit 99.50');
  });

  it('is operable from the keyboard: side and type with arrows, quantity with arrows and steppers', async () => {
    const { ticket } = await mount();
    const buy = radio(ticket, 'side', 'buy');
    buy.focus();
    key(buy, 'ArrowRight');
    await rendered(ticket);
    expect(radio(ticket, 'side', 'sell').getAttribute('aria-checked')).toBe('true');
    expect(radio(ticket, 'side', 'sell').tabIndex).toBe(0);
    expect(shadow(ticket).activeElement).toBe(radio(ticket, 'side', 'sell'));

    key(radio(ticket, 'kind', 'market'), 'End');
    await rendered(ticket);
    expect(radio(ticket, 'kind', 'stop-limit').getAttribute('aria-checked')).toBe('true');
    expect(shadow(ticket).querySelector('#stopPrice')).not.toBeNull();
    expect(shadow(ticket).querySelector('#limitPrice')).not.toBeNull();

    const quantity = query<HTMLInputElement>(ticket, '#quantity');
    key(quantity, 'ArrowUp');
    key(quantity, 'ArrowUp');
    await rendered(ticket);
    expect(quantity.value).toBe('3');
    query<HTMLButtonElement>(ticket, '[aria-label="Decrease quantity"]').click();
    await rendered(ticket);
    expect(quantity.value).toBe('2');
    expect(text(query(ticket, '[part~="submit-button"]'))).toBe('Sell 2 ACME stop 99.99 limit 99.99');
  });

  it('runs the check and confirm steps when asked to', async () => {
    const { ticket, session, settle } = await mount({ 'check-orders': '' });
    query<HTMLFormElement>(ticket, 'form').requestSubmit();
    await settle();
    await rendered(ticket);
    const review = query(ticket, '[part="review"]');
    expect(text(review)).toContain('Confirm: Buy 1 ACME at market');
    expect(text(review)).toContain('Cost100.02 USD');
    expect(shadow(ticket).activeElement).toBe(query(ticket, '[part~="confirm-button"]'));
    expect(session.orders).toEqual([]);

    query<HTMLButtonElement>(ticket, '[part~="confirm-button"]').click();
    await settle();
    await rendered(ticket);
    expect(session.positions[0]).toMatchObject({ side: 'buy', quantity: 1 });
    expect(shadow(ticket).querySelector('[part="review"]')).toBeNull();
  });

  it('changes a working order in amend mode', async () => {
    const { ticket, session, settle } = await mount();
    const orderId = await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 2, limitPrice: 101 });
    await settle();
    await ticket.amend(session.getOrder(orderId)!);
    await rendered(ticket);
    expect(text(query(ticket, '[part="mode"]'))).toBe(`Changing ${orderId}`);
    expect(radio(ticket, 'side', 'buy').disabled).toBe(true);
    const amended: TdkOrderAmendedDetail[] = [];
    ticket.addEventListener('tdk-order-amended', (event) => amended.push(event.detail));

    type(query<HTMLInputElement>(ticket, '#limitPrice'), '100.75');
    await rendered(ticket);
    expect(text(query(ticket, '[part~="submit-button"]'))).toBe('Change order');
    query<HTMLFormElement>(ticket, 'form').requestSubmit();
    await settle();
    await rendered(ticket);
    expect(amended).toEqual([{ orderId, changes: { limitPrice: 100.75 } }]);
    expect(session.getOrder(orderId)?.limitPrice).toBe(100.75);
    expect(shadow(ticket).querySelector('[part="mode"]')).toBeNull();
  });

  it('says why it cannot be used', async () => {
    const { ticket, session, settle } = await mount();
    await session.stop();
    await settle();
    await rendered(ticket);
    expect(text(query(ticket, '[part="status"]'))).toBe('Not connected to the broker');
    expect(query<HTMLButtonElement>(ticket, '[part~="submit-button"]').disabled).toBe(true);
  });
});
