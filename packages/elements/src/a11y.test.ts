// @vitest-environment happy-dom
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import { ACME, query, rendered, setupTrading, shadow, text } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

/** Lowercase words without punctuation or symbols, as axe compares names and visible text. */
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Text a sighted user reads: everything except visually hidden text. */
function visibleText(node: Node): string {
  if (node instanceof Element && node.classList.contains('visually-hidden')) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  return [...node.childNodes].map(visibleText).join('');
}

/** A button's accessible name: `aria-label`, or its text without `aria-hidden` parts. */
function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label !== null) return label;
  const fromContent = (node: Node): string => {
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    return [...node.childNodes].map(fromContent).join('');
  };
  return fromContent(element);
}

/** Buttons whose accessible name does not contain their visible text (WCAG 2.5.3, Label in Name). */
function labelInNameProblems(...hosts: HTMLElement[]): string[] {
  return hosts.flatMap((host) =>
    [...shadow(host).querySelectorAll('button')].flatMap((button) => {
      const visible = words(visibleText(button));
      // Symbols such as "+", "−" and "×" are not words; axe leaves them to a person to judge as well.
      if (visible.length < 2) return [];
      const name = words(accessibleName(button));
      return name.includes(visible) ? [] : [`${host.localName} "${visible}" is named "${name}"`];
    }),
  );
}

/** axe's WCAG A and AA rules over the page, element shadow roots included. Contrast needs a layout engine and is left out. */
async function axeViolations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${JSON.stringify(node.target)}`));
}

async function mountAll() {
  const trading = await setupTrading();
  await trading.quote(111.2, 111.22);
  const ticket = document.createElement('tdk-order-ticket');
  ticket.kind = 'limit';
  const buttons = document.createElement('tdk-trade-buttons');
  buttons.quantity = 10;
  const panel = document.createElement('tdk-account-panel');
  const notifications = document.createElement('tdk-notifications');
  for (const element of [ticket, buttons]) element.instrument = ACME;
  for (const element of [ticket, buttons, panel, notifications]) {
    element.session = trading.session;
    element.feed = trading.feed;
  }
  document.body.append(ticket, buttons, panel, notifications);
  await ticket.updateComplete;
  await Promise.all([ticket.activeController!.ready, buttons.activeController!.ready]);
  const all = [ticket, buttons, panel, notifications];
  const settled = async () => {
    await trading.settle();
    for (const element of all) await rendered(element);
  };
  await settled();
  return { ...trading, ticket, buttons, panel, notifications, all, settled };
}

describe('accessibility', () => {
  it('names the ticket quote buttons with their visible text', async () => {
    const { ticket } = await mountAll();
    const bid = query(ticket, '[part="bid"]');
    expect(text(bid)).toBe('Bid 111.20');
    expect(bid.getAttribute('aria-label')).toBe('Bid 111.20, use as price');
    expect(text(query(ticket, '[part="ask"]'))).toBe('Ask 111.22');
    expect(text(query(ticket, '[part="spread"]'))).toBe('Spread 0.02');
  });

  it('names the trade buttons by their visible text and describes the order separately', async () => {
    const { buttons, session, settled } = await mountAll();
    const sell = query(buttons, '[part~="sell-button"]');
    const buy = query(buttons, '[part~="buy-button"]');
    expect(sell.hasAttribute('aria-label')).toBe(false);
    expect(words(accessibleName(sell))).toBe('sell 111 20');
    expect(text(query(buttons, `#${sell.getAttribute('aria-describedby')}`))).toBe('Sell 10 ACME at market');
    expect(text(query(buttons, `#${buy.getAttribute('aria-describedby')}`))).toBe('Buy 10 ACME at market');

    // The spread is plain text in the page, read like the rest.
    const spread = query(buttons, '[part="spread"]');
    expect(spread.hasAttribute('aria-label')).toBe(false);
    expect(spread.querySelector('[aria-hidden]')).toBeNull();
    expect(text(spread)).toBe('Spread 0.02');

    await session.stop();
    await settled();
    expect(text(query(buttons, '#sell-description'))).toBe('Sell 10 ACME at market. Not connected to the broker');
  });

  it('starts the TP/SL button name with its visible text', async () => {
    const { panel, session, settled } = await mountAll();
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 10 });
    panel.tab = 'positions';
    await settled();
    const exits = query(panel, '[part~="exits-button"]');
    expect(exits.hasAttribute('aria-label')).toBe(false);
    expect(visibleText(exits).trim()).toBe('TP/SL');
    expect(text(exits)).toBe('TP/SL: edit take-profit and stop-loss, Long 10 ACME');
  });

  it('passes axe and keeps visible text in every button name, with orders, a position and when disconnected', async () => {
    const { all, ticket, panel, session, settled } = await mountAll();
    expect(labelInNameProblems(...all)).toEqual([]);
    expect(await axeViolations()).toEqual([]);

    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 10, limitPrice: 110, takeProfit: 115, stopLoss: 105 });
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 5 });
    await settled();
    expect(labelInNameProblems(...all)).toEqual([]);
    expect(await axeViolations()).toEqual([]);

    panel.tab = 'positions';
    ticket.kind = 'market';
    await settled();
    expect(labelInNameProblems(...all)).toEqual([]);
    expect(await axeViolations()).toEqual([]);

    await session.stop();
    await settled();
    expect(labelInNameProblems(...all)).toEqual([]);
    expect(await axeViolations()).toEqual([]);
  });
});
