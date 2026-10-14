// @vitest-environment happy-dom
import { NotificationCenter } from '@tickdeck/widgets-core';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import type { TdkDismissDetail } from './events';
import { ACME, key, query, rendered, setupTrading, shadow, text } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

describe('<tdk-notifications>', () => {
  it('shows fills as toasts, announces them and keeps a log', async () => {
    const { session, feed, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    const element = document.createElement('tdk-notifications');
    element.session = session;
    element.feed = feed;
    document.body.append(element);
    await rendered(element);

    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 2 });
    await settle();
    await rendered(element);
    expect(text(query(element, '[part~="toast"]'))).toBe('Order filled Bought 2 ACME at 100.02 ×');
    expect(query(element, '[part~="toast"]').getAttribute('part')).toBe('toast toast-success');
    expect(text(query(element, '[role="status"]'))).toBe('Order filled. Bought 2 ACME at 100.02');
    expect(text(query(element, '[role="alert"]'))).toBe('');

    // A rejection is announced assertively.
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 0.5 });
    await settle();
    await rendered(element);
    expect(text(query(element, '[role="alert"]'))).toBe(
      'Order rejected. Buy 0.5 ACME Market: Quantity 0.5 is below the minimum',
    );

    const toggle = query<HTMLButtonElement>(element, '[part="log-toggle"]');
    expect(text(toggle)).toBe('Notifications (2)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await rendered(element);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect([...shadow(element).querySelectorAll('[part="log-item"] .title')].map(text)).toEqual(['Order rejected', 'Order filled']);
  });

  it('dismisses toasts with the button or Escape', async () => {
    const { session } = await setupTrading();
    const center = new NotificationCenter({ session });
    const element = document.createElement('tdk-notifications');
    element.controller = center;
    element.setAttribute('hide-log', '');
    element.setAttribute('placement', 'bottom-end');
    document.body.append(element);
    await rendered(element);
    const dismissed: TdkDismissDetail[] = [];
    element.addEventListener('tdk-dismiss', (event) => dismissed.push(event.detail));

    center.push({ level: 'info', title: 'First' });
    center.push({ level: 'warning', title: 'Second', message: 'Careful' });
    await rendered(element);
    expect([...shadow(element).querySelectorAll('[part~="toast"]')].map(text)).toEqual(['First ×', 'Second Careful ×']);
    expect(shadow(element).querySelector('[part="log-toggle"]')).toBeNull();

    query<HTMLButtonElement>(element, '[aria-label="Dismiss: First"]').click();
    await rendered(element);
    key(query(element, '[part~="toast"] button'), 'Escape');
    await rendered(element);
    expect(shadow(element).querySelectorAll('[part~="toast"]')).toHaveLength(0);
    expect(dismissed.map((detail) => detail.notification.title)).toEqual(['First', 'Second']);

    // Hovering pauses auto-dismiss.
    query(element, '[part="toasts"]').dispatchEvent(new Event('mouseenter'));
    expect(center.state.value.paused).toBe(true);
    query(element, '[part="toasts"]').dispatchEvent(new Event('mouseleave'));
    expect(center.state.value.paused).toBe(false);
  });
});
