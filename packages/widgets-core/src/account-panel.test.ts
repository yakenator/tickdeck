import type { BrokerOrder, BrokerPosition } from '@tickdeck/broker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanelController, type AccountPanelEvents, type PanelStatus } from './account-panel';
import { ACME, NOW, setupTrading } from './test-setup';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccountPanelController', () => {
  it('goes from loading to ready when the session starts', async () => {
    const { context, session, settle } = await setupTrading({ start: false });
    const panel = new AccountPanelController(context);
    const statuses: PanelStatus[] = [];
    panel.subscribe((state) => statuses.push(state.status), { emitCurrent: true });

    await session.start();
    await settle();
    expect(statuses[0]).toBe('disconnected');
    expect(statuses).toContain('loading');
    expect(statuses.at(-1)).toBe('ready');
    expect(panel.state.value.summary?.items.map((item) => [item.id, item.text])).toEqual([
      ['balance', '100,000.00'],
      ['equity', '100,000.00'],
      ['unrealized-pnl', '0.00'],
      ['realized-pnl', '0.00'],
    ]);
    expect(panel.state.value.summary).toMatchObject({ accountId: 'demo', accountName: 'Demo account', currency: 'USD' });

    await session.stop();
    await settle();
    expect(panel.state.value.status).toBe('disconnected');
  });

  it('cancels orders and filters working and all orders', async () => {
    const { context, session, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    const panel = new AccountPanelController(context);
    const first = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 2, limitPrice: 99 });
    const second = await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 1, limitPrice: 101 });
    await settle();
    expect(panel.state.value.orders.map((row) => row.id)).toEqual([second, first]);

    const cancelling = panel.cancelOrder(first);
    expect(panel.state.value.orders.find((row) => row.id === first)).toMatchObject({ busy: true, canCancel: false });
    expect(await cancelling).toBe(true);
    expect(session.getOrder(first)?.state).toBe('cancelled');
    expect(panel.state.value.orders.map((row) => row.id)).toEqual([second]);
    expect(panel.state.value.counts.orders).toBe(1);

    panel.setOrderFilter('all');
    expect(panel.state.value.orders.map((row) => [row.id, row.cells.status, row.working, row.canCancel])).toEqual([
      [second, 'Working', true, true],
      [first, 'Cancelled', false, false],
    ]);
    expect(panel.state.value.orders[1]!.tones.status).toBe('muted');

    // A failing action reports its error and does not throw.
    const failures: AccountPanelEvents['action-error'][] = [];
    panel.on('action-error', (event) => failures.push(event));
    expect(await panel.cancelOrder(first)).toBe(false);
    expect(failures).toEqual([expect.objectContaining({ action: 'cancel', targetId: first, message: `Order ${first} is already cancelled` })]);
    expect(panel.state.value.error).toBe(`Order ${first} is already cancelled`);
    panel.clearError();
    expect(panel.state.value.error).toBeUndefined();
  });

  it('closes part of a position, reverses it and closes the rest', async () => {
    const { context, session, quote } = await setupTrading();
    await quote(100, 100.02);
    const panel = new AccountPanelController(context);
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 10 });
    await quote(100.1, 100.12);
    const position = () => panel.state.value.positions[0];
    const id = position()!.id;
    expect(position()).toMatchObject({ canClose: true, canPartialClose: true, canReverse: true, canEditExits: true });
    expect(position()!.cells).toMatchObject({ side: 'Long', quantity: '10', average: '100.02', unrealized: '+0.80' });
    expect(position()!.tones.unrealized).toBe('positive');

    panel.beginClose(id);
    expect(panel.state.value.closing).toEqual({ positionId: id, quantity: 10, maximum: 10 });
    panel.setCloseQuantity(12);
    expect(panel.state.value.closing?.error).toBe('At most 10');
    panel.setCloseQuantity(2.5);
    expect(panel.state.value.closing?.error).toBe('Use steps of 1');
    panel.setCloseQuantity(4);
    expect(panel.state.value.closing?.error).toBeUndefined();
    expect(await panel.confirmClose()).toBe(true);
    expect(panel.state.value.closing).toBeUndefined();
    expect(session.getPosition(id)).toMatchObject({ side: 'buy', quantity: 6 });
    expect(panel.state.value.summary?.items.find((item) => item.id === 'realized-pnl')?.text).toBe('+0.32');

    expect(await panel.reversePosition(id)).toBe(true);
    expect(session.positions).toEqual([expect.objectContaining({ side: 'sell', quantity: 6 })]);
    expect(position()!.cells.side).toBe('Short');

    expect(await panel.closePosition(position()!.id)).toBe(true);
    expect(session.positions).toEqual([]);
    expect(panel.state.value.positions).toEqual([]);
    expect(panel.state.value.fills.map((row) => [row.cells.side, row.cells.quantity, row.cells.price])).toEqual([
      ['Buy', '6', '100.12'],
      ['Sell', '12', '100.10'],
      ['Sell', '4', '100.10'],
      ['Buy', '10', '100.02'],
    ]);
  });

  it('sorts by column and flips the direction on the second click', async () => {
    const { context, session, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    await quote(40_000, 40_001, 'MOCK:BTCUSD');
    await quote(1.08, 1.08003, 'MOCK:EURUSD');
    const panel = new AccountPanelController(context, { tab: 'positions' });
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 5 });
    await session.submitOrder({ instrument: 'MOCK:BTCUSD', side: 'sell', kind: 'market', quantity: 0.25 });
    await session.submitOrder({ instrument: 'MOCK:EURUSD', side: 'buy', kind: 'market', quantity: 20_000 });
    await settle();
    const names = () => panel.state.value.positions.map((row) => row.cells.instrument);

    expect(names()).toEqual(['ACME', 'BTCUSD', 'EURUSD']);
    expect(panel.state.value.positions.map((row) => [row.cells.quantity, row.cells.average])).toEqual([
      ['5', '100.02'],
      ['0.250', '40,000.0'],
      ['20,000', '1.08003'],
    ]);
    panel.sortBy('quantity');
    expect(panel.state.value.sort.positions).toEqual({ column: 'quantity', direction: 'asc' });
    expect(names()).toEqual(['BTCUSD', 'ACME', 'EURUSD']);
    panel.sortBy('quantity');
    expect(panel.state.value.sort.positions).toEqual({ column: 'quantity', direction: 'desc' });
    expect(names()).toEqual(['EURUSD', 'ACME', 'BTCUSD']);
    panel.sortBy('side');
    expect(panel.state.value.positions.map((row) => row.cells.side)).toEqual(['Long', 'Long', 'Short']);
    panel.sortBy('unknown');
    expect(panel.state.value.sort.positions.column).toBe('side');

    panel.setTab('fills');
    expect(panel.state.value.tab).toBe('fills');
    expect(panel.state.value.columns.fills.map((column) => column.id)).toEqual([
      'time',
      'instrument',
      'side',
      'quantity',
      'price',
      'commission',
      'realized',
    ]);
    expect(panel.state.value.fills[0]!.cells.time).toBe('12:00:30');
  });

  it('asks the application to amend orders and edit exits', async () => {
    const { context, session, quote, settle } = await setupTrading();
    await quote(100, 100.02);
    const panel = new AccountPanelController(context);
    const amends: BrokerOrder[] = [];
    const exits: BrokerPosition[] = [];
    panel.on('amend', (order) => amends.push(order));
    panel.on('edit-exits', (position) => exits.push(position));

    const orderId = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 1, limitPrice: 99 });
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 1 });
    await settle();
    const positionId = session.positions[0]!.id;

    panel.requestAmend(orderId);
    panel.requestEditExits(positionId);
    expect(amends.map((order) => order.id)).toEqual([orderId]);
    expect(exits.map((position) => position.id)).toEqual([positionId]);

    expect(await panel.setPositionExits(positionId, { takeProfit: 101, stopLoss: 99.5 })).toBe(true);
    expect(panel.state.value.positions[0]!.cells).toMatchObject({ 'take-profit': '101.00', 'stop-loss': '99.50' });
  });
});
