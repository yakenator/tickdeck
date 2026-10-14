// @vitest-environment happy-dom
import type { Scheduler } from '@tickdeck/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './define';
import { ACME, query, rendered, setupTrading, shadow, text } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const NOW = Date.UTC(2026, 9, 14, 12, 0, 30);

/** A clock fixed at NOW with real timers, for the broker and the elements. */
const clock: Scheduler = {
  now: () => NOW,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

async function trading() {
  const setup = await setupTrading({ scheduler: clock });
  await setup.quote(100, 100.02);
  return setup;
}

describe('time-zone and scheduler', () => {
  it('shows the account panel times in the time zone, and switches without losing state', async () => {
    const { session, feed, settle } = await trading();
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 1 });
    await settle();
    const panel = document.createElement('tdk-account-panel');
    panel.setAttribute('time-zone', 'Asia/Seoul');
    panel.setAttribute('tab', 'fills');
    panel.scheduler = clock;
    panel.session = session;
    panel.feed = feed;
    document.body.append(panel);
    await rendered(panel);
    const time = () => text(shadow(panel).querySelector('td[data-column="time"]'));
    const controller = panel.activeController!;
    expect(panel.timeZone).toBe('Asia/Seoul');
    expect(controller.context).toMatchObject({ timeZone: 'Asia/Seoul', scheduler: clock });
    expect(time()).toBe('21:00:30');

    panel.timeZone = 'America/New_York';
    await rendered(panel);
    expect(time()).toBe('08:00:30');
    expect(panel.activeController).toBe(controller);
    expect(controller.state.value.tab).toBe('fills');

    panel.removeAttribute('time-zone');
    await rendered(panel);
    expect(controller.timeZone).toBeUndefined();
  });

  it('dates the notification log in the time zone, on the given clock', async () => {
    const { session, feed } = await trading();
    const notifications = document.createElement('tdk-notifications');
    notifications.timeZone = 'Etc/UTC';
    notifications.scheduler = clock;
    notifications.session = session;
    notifications.feed = feed;
    document.body.append(notifications);
    await rendered(notifications);
    notifications.activeController!.push({ level: 'info', title: 'Market opens' });
    query<HTMLButtonElement>(notifications, '[part="log-toggle"]').click();
    await rendered(notifications);
    expect(text(query(notifications, '[part="log-item"] time'))).toBe('12:00:30');

    notifications.setAttribute('time-zone', 'Asia/Tokyo');
    await rendered(notifications);
    expect(text(query(notifications, '[part="log-item"] time'))).toBe('21:00:30');
  });

  it('enters and shows the ticket expiry in the time zone', async () => {
    const { session, feed } = await trading();
    const ticket = document.createElement('tdk-order-ticket');
    Object.assign(ticket, { instrument: ACME, kind: 'limit', timeZone: 'America/New_York', scheduler: clock, session, feed });
    document.body.append(ticket);
    await rendered(ticket);
    await ticket.activeController!.ready;
    ticket.activeController!.setTimeInForce('gtd');
    await rendered(ticket);
    const expiry = query<HTMLInputElement>(ticket, '[part~="expiry-input"]');
    expiry.value = '2026-10-15T16:00';
    expiry.dispatchEvent(new Event('change'));
    await rendered(ticket);
    expect(ticket.activeController!.state.value.expiresAt).toBe(Date.UTC(2026, 9, 15, 20, 0));

    ticket.timeZone = 'Europe/London';
    await rendered(ticket);
    expect(query<HTMLInputElement>(ticket, '[part~="expiry-input"]').value).toBe('2026-10-15T21:00');
  });

  it('falls back to the browser time zone for an unknown one, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { session, feed } = await trading();
    const panel = document.createElement('tdk-account-panel');
    panel.setAttribute('time-zone', 'Mars/Olympus_Mons');
    panel.session = session;
    panel.feed = feed;
    document.body.append(panel);
    await rendered(panel);
    expect(panel.activeController!.timeZone).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('<tdk-account-panel>: unknown time zone "Mars/Olympus_Mons"; showing times in the browser\'s time zone');
  });
});
