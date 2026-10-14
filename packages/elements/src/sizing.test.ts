// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import { ACME, query, rendered, setupTrading } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

describe('sizing', () => {
  it('makes each element a flex column whose visible box grows to the height it is given', async () => {
    const { session, feed } = await setupTrading();
    const ticket = document.createElement('tdk-order-ticket');
    ticket.instrument = ACME;
    const buttons = document.createElement('tdk-trade-buttons');
    buttons.instrument = ACME;
    const panel = document.createElement('tdk-account-panel');
    const notifications = document.createElement('tdk-notifications');
    const all = [ticket, buttons, panel, notifications];
    for (const element of all) {
      element.session = session;
      element.feed = feed;
    }
    document.body.append(...all);
    for (const element of all) await rendered(element);

    for (const element of all) {
      const host = getComputedStyle(element);
      expect([element.localName, host.display, host.flexDirection]).toEqual([element.localName, 'flex', 'column']);
    }
    for (const [element, root] of [
      [ticket, '[part="form"]'],
      [buttons, '[part="container"]'],
      [panel, '[part="panel"]'],
    ] as const) {
      expect([element.localName, getComputedStyle(query(element, root)).flexGrow]).toEqual([element.localName, '1']);
    }
    // A short panel keeps its tabs and scrolls the table instead of overflowing.
    const tabpanel = getComputedStyle(query(panel, '[part="tabpanel"]'));
    expect([tabpanel.flexGrow, Number.parseFloat(tabpanel.minHeight), tabpanel.getPropertyValue('overflow')]).toEqual(['1', 0, 'auto']);
  });

  it('can be hidden', async () => {
    const ticket = document.createElement('tdk-order-ticket');
    ticket.hidden = true;
    document.body.append(ticket);
    await rendered(ticket);
    expect(getComputedStyle(ticket).display).toBe('none');
  });
});
