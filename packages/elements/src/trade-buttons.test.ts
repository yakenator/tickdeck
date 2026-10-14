// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import type { TdkOrderPlacedDetail } from './events';
import { ACME, key, query, rendered, setupTrading, shadow, text } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(confirm = false) {
  const trading = await setupTrading();
  await trading.quote(100, 100.02);
  const buttons = document.createElement('tdk-trade-buttons');
  buttons.instrument = ACME;
  buttons.quantity = 5;
  if (confirm) buttons.setAttribute('confirm', '');
  buttons.session = trading.session;
  buttons.feed = trading.feed;
  document.body.append(buttons);
  await rendered(buttons);
  await buttons.activeController!.ready;
  await rendered(buttons);
  return { ...trading, buttons };
}

describe('<tdk-trade-buttons>', () => {
  it('shows bid, ask and spread and buys at market in one click', async () => {
    const { buttons, session, quote, settle } = await mount();
    const buy = query<HTMLButtonElement>(buttons, '[part~="buy-button"]');
    const sell = query<HTMLButtonElement>(buttons, '[part~="sell-button"]');
    expect([text(sell), text(query(buttons, '[part="spread"]')), text(buy)]).toEqual(['Sell 100.00', 'Spread 0.02', 'Buy 100.02']);
    expect(text(query(buttons, `#${buy.getAttribute('aria-describedby')}`))).toBe('Buy 5 ACME at market');

    await quote(100.5, 100.53);
    await rendered(buttons);
    expect(text(buy)).toBe('Buy 100.53');

    const placed: TdkOrderPlacedDetail[] = [];
    buttons.addEventListener('tdk-order-placed', (event) => placed.push(event.detail));
    buy.click();
    await settle();
    await rendered(buttons);
    expect(placed.map((detail) => detail.request)).toEqual([{ instrument: ACME, side: 'buy', kind: 'market', quantity: 5 }]);
    expect(session.positions[0]).toMatchObject({ side: 'buy', quantity: 5, averagePrice: 100.53 });
    expect(text(query(buttons, '[part="result"]'))).toBe('Order placed: Buy 5 ACME at market');
  });

  it('asks for confirmation in confirm mode', async () => {
    const { buttons, session, settle } = await mount(true);
    query<HTMLButtonElement>(buttons, '[part~="sell-button"]').click();
    await rendered(buttons);
    const confirm = query<HTMLButtonElement>(buttons, '[part~="confirm-button"]');
    expect(text(query(buttons, '[part="confirm"]'))).toBe('Sell 5 ACME at market? Confirm Cancel');
    expect(shadow(buttons).activeElement).toBe(confirm);
    expect(session.orders).toEqual([]);

    key(confirm, 'Escape');
    await rendered(buttons);
    expect(shadow(buttons).querySelector('[part="confirm"]')).toBeNull();
    expect(shadow(buttons).activeElement).toBe(query(buttons, '[part~="sell-button"]'));

    query<HTMLButtonElement>(buttons, '[part~="sell-button"]').click();
    await rendered(buttons);
    query<HTMLButtonElement>(buttons, '[part~="confirm-button"]').click();
    await settle();
    expect(session.positions[0]).toMatchObject({ side: 'sell', quantity: 5 });
  });

  it('disables both sides with a reason', async () => {
    const { buttons, session, settle } = await mount();
    const quantity = query<HTMLInputElement>(buttons, '#quantity');
    quantity.value = '0.5';
    quantity.dispatchEvent(new Event('input'));
    await rendered(buttons);
    expect(text(query(buttons, '[part="reason"]'))).toBe('Minimum is 1');
    expect(query<HTMLButtonElement>(buttons, '[part~="buy-button"]').disabled).toBe(true);

    await session.stop();
    await settle();
    await rendered(buttons);
    expect(text(query(buttons, '[part="reason"]'))).toBe('Not connected to the broker');
    expect(query<HTMLButtonElement>(buttons, '[part~="sell-button"]').disabled).toBe(true);
  });
});
