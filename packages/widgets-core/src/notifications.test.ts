import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter, type NotificationItem } from './notifications';
import { OrderTicketController } from './order-ticket';
import { ACME, NOW, SpyBroker, flush, setupTrading } from './test-setup';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const brief = (items: readonly NotificationItem[]) => items.map((item) => [item.level, item.title, item.message]);

describe('NotificationCenter', () => {
  it('announces fills, the take-profit and its realized P&L', async () => {
    const { context, session, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    const center = new NotificationCenter(context);
    const ticket = new OrderTicketController(context, { instrument: ACME, kind: 'limit', quantity: 10 });
    await ticket.ready;
    ticket.setLimitPrice(99.5);
    ticket.setExitPrice('takeProfit', 101);
    ticket.setExitPrice('stopLoss', 98.5);
    expect(await ticket.submit()).toBe(true);
    expect(center.state.value.toasts).toEqual([]);

    await quote(99.4, 99.48);
    await quote(101.05, 101.07);
    await settle();
    expect(brief(center.state.value.toasts)).toEqual([
      ['success', 'Order filled', 'Bought 10 ACME at 99.50'],
      ['success', 'Take-profit filled', 'Sold 10 ACME at 101.00, P&L +15.00 USD'],
    ]);
    expect(center.state.value.log.map((item) => item.title)).toEqual(['Take-profit filled', 'Order filled']);
    expect(session.positions).toEqual([]);
  });

  it('shows one error per rejected order, even when the broker also sends a notice', async () => {
    const { context, session, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    const center = new NotificationCenter(context);
    const id = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 2.5 });
    await settle();
    expect(session.getOrder(id)?.state).toBe('rejected');
    expect(brief(center.state.value.toasts)).toEqual([
      ['error', 'Order rejected', 'Buy 2.5 ACME Market: Quantity 2.5 is not a multiple of the quantity step'],
    ]);
    expect(center.state.value.toasts[0]).toMatchObject({ source: 'rejection', orderId: id });
  });

  it('reports acknowledgement timeouts, ignored updates, notices and connection changes', async () => {
    const { context, session, broker, feed } = await setupTrading({
      broker: { latencyMs: 20_000 },
      session: { ackTimeoutMs: 5_000 },
    });
    await feed.setQuote(ACME, { bid: 100, ask: 100.02 });
    const center = new NotificationCenter(context, { durations: { error: 0, warning: 0, info: 0, success: 0 } });
    const sink = (broker as SpyBroker).sink!;

    const orderId = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(brief(center.state.value.toasts)).toEqual([
      ['error', 'No confirmation from the broker', 'The broker did not confirm the order within 5 s. Reloading trading state.'],
    ]);
    expect(center.state.value.toasts[0]).toMatchObject({ source: 'timeout', orderId });

    sink.emit('order', { id: 'x1', instrument: ACME, side: 'buy', kind: 'market', quantity: 1, state: 'filled', filledQuantity: 1 });
    sink.emit('order', { id: 'x1', instrument: ACME, side: 'buy', kind: 'market', quantity: 1, state: 'open', filledQuantity: 1 });
    sink.emit('notice', { level: 'info', title: 'Market closes in 10 minutes' });
    sink.emit('connection', { state: 'disconnected', message: 'Network down' });
    sink.emit('connection', { state: 'connected' });
    await flush();
    expect(brief(center.state.value.log)).toEqual([
      ['success', 'Reconnected', undefined],
      ['warning', 'Connection to the broker lost', 'Network down'],
      ['info', 'Market closes in 10 minutes', undefined],
      ['warning', 'Ignored an inconsistent order update', 'Order x1 cannot move from filled to open'],
      ['error', 'No confirmation from the broker', 'The broker did not confirm the order within 5 s. Reloading trading state.'],
    ]);
    // Four toasts at most: the oldest one left the screen but stays in the log.
    expect(center.state.value.toasts.map((item) => item.source)).toEqual(['violation', 'notice', 'connection', 'connection']);
  });

  it('dismisses toasts after their duration, pauses while read, and keeps the log', async () => {
    const { context } = await setupTrading();
    const center = new NotificationCenter(context, { maxToasts: 2 });
    const dismissed: string[] = [];
    center.on('dismiss', (item) => dismissed.push(item.title));

    center.push({ level: 'info', title: 'One' });
    await vi.advanceTimersByTimeAsync(2_000);
    center.push({ level: 'error', title: 'Two' });
    await vi.advanceTimersByTimeAsync(2_000);
    center.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(center.state.value.toasts.map((item) => item.title)).toEqual(['One', 'Two']);

    center.resume();
    await vi.advanceTimersByTimeAsync(999);
    expect(center.state.value.toasts.map((item) => item.title)).toEqual(['One', 'Two']);
    await vi.advanceTimersByTimeAsync(1);
    expect(center.state.value.toasts.map((item) => item.title)).toEqual(['Two']);

    // Only `maxToasts` stay on screen; the oldest leaves first.
    center.push({ level: 'success', title: 'Three' });
    center.push({ level: 'warning', title: 'Four', durationMs: 0 });
    expect(center.state.value.toasts.map((item) => item.title)).toEqual(['Three', 'Four']);
    center.dismiss(center.state.value.toasts[0]!.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(center.state.value.toasts.map((item) => item.title)).toEqual(['Four']);
    center.dismissAll();

    expect(dismissed).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(center.state.value.log.map((item) => item.title)).toEqual(['Four', 'Three', 'Two', 'One']);
    center.clearLog();
    expect(center.state.value.log).toEqual([]);
  });

  it('can leave sources out', async () => {
    const { context, session, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    const center = new NotificationCenter(context, { sources: { fill: false } });
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 1 });
    await settle();
    expect(center.state.value.log).toEqual([]);
  });
});
