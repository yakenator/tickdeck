import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { describe, expect, it } from 'vitest';
import { TradingEdits, lineTargetIds, planLineMove, planLineRemoval, runTradingAction } from './actions';
import type { TradingLine, TradingLineTarget } from './scene';

const line = (target: TradingLineTarget, fields: Partial<TradingLine> = {}): TradingLine => ({
  id: 'line',
  kind: 'order',
  group: 'orders',
  side: 'buy',
  price: 100,
  quantity: 1,
  label: 'BUY LMT 1',
  target,
  draggable: true,
  removable: true,
  pending: false,
  ...fields,
});

const full = { amendOrders: true, positionExits: true };
const noPositionExits = { amendOrders: true, positionExits: false };

describe('planLineMove', () => {
  it('amends the price field of an order', () => {
    expect(planLineMove(line({ type: 'order', orderId: 'o1', field: 'limitPrice' }), 101, full)).toEqual({
      type: 'amend-order',
      orderId: 'o1',
      changes: { limitPrice: 101 },
    });
    expect(planLineMove(line({ type: 'order', orderId: 'o1', field: 'stopPrice' }), 99, full)).toEqual({
      type: 'amend-order',
      orderId: 'o1',
      changes: { stopPrice: 99 },
    });
  });

  it('amends exits of entry orders on the entry', () => {
    const target: TradingLineTarget = { type: 'order-exit', entryOrderId: 'o1', role: 'stop-loss', exitOrderId: 'x1' };
    expect(planLineMove(line(target), 95, full)).toEqual({ type: 'amend-order', orderId: 'o1', changes: { stopLoss: 95 } });
  });

  it('sets position exits, or amends the exit order when the broker has no position exits', () => {
    const target: TradingLineTarget = { type: 'position-exit', positionId: 'p1', role: 'take-profit', exitOrderId: 'x1' };
    expect(planLineMove(line(target), 110, full)).toEqual({
      type: 'set-position-exits',
      positionId: 'p1',
      exits: { takeProfit: 110 },
    });
    expect(planLineMove(line(target), 110, noPositionExits)).toEqual({
      type: 'amend-order',
      orderId: 'x1',
      changes: { limitPrice: 110 },
    });
    expect(planLineMove(line({ ...target, exitOrderId: undefined }), 110, noPositionExits)).toBeUndefined();
  });

  it('does not move positions or locked lines', () => {
    expect(planLineMove(line({ type: 'position', positionId: 'p1' }), 1, full)).toBeUndefined();
    expect(planLineMove(line({ type: 'order', orderId: 'o1', field: 'limitPrice' }, { draggable: false }), 1, full)).toBeUndefined();
  });
});

describe('planLineRemoval', () => {
  it('cancels orders, removes exits and closes positions', () => {
    expect(planLineRemoval(line({ type: 'order', orderId: 'o1', field: 'limitPrice' }), full)).toEqual({ type: 'cancel-order', orderId: 'o1' });
    expect(planLineRemoval(line({ type: 'order-exit', entryOrderId: 'o1', role: 'take-profit' }), full)).toEqual({
      type: 'amend-order',
      orderId: 'o1',
      changes: { takeProfit: null },
    });
    const exit: TradingLineTarget = { type: 'position-exit', positionId: 'p1', role: 'stop-loss', exitOrderId: 'x1' };
    expect(planLineRemoval(line(exit), full)).toEqual({ type: 'set-position-exits', positionId: 'p1', exits: { stopLoss: null } });
    expect(planLineRemoval(line(exit), noPositionExits)).toEqual({ type: 'cancel-order', orderId: 'x1' });
    expect(planLineRemoval(line({ type: 'position', positionId: 'p1' }), full)).toEqual({ type: 'close-position', positionId: 'p1' });
    expect(planLineRemoval(line({ type: 'position', positionId: 'p1' }, { removable: false }), full)).toBeUndefined();
  });

  it('lists the ids whose updates concern a line', () => {
    expect(lineTargetIds({ type: 'order-exit', entryOrderId: 'o1', role: 'take-profit', exitOrderId: 'x1' })).toEqual(['o1', 'x1']);
    expect(lineTargetIds({ type: 'position-exit', positionId: 'p1', role: 'take-profit' })).toEqual(['p1']);
  });
});

describe('TradingEdits', () => {
  const model = (price: number) => [line({ type: 'order', orderId: 'o1', field: 'limitPrice' }, { price })];

  it('keeps a moved line until the broker reports the new price', () => {
    const edits = new TradingEdits();
    edits.begin('line', { price: 101 }, ['o1']);
    edits.reconcile(model(100));
    expect(edits.view.get('line')).toMatchObject({ price: 101 });
    edits.touch(['o1']);
    edits.reconcile(model(101));
    expect(edits.size).toBe(0);
  });

  it('drops an edit once the call resolved and the broker answered with another price', () => {
    const edits = new TradingEdits();
    edits.begin('line', { price: 101 }, ['o1']);
    edits.touch(['other']);
    edits.settle('line');
    edits.reconcile(model(100));
    expect(edits.has('line')).toBe(true);
    edits.touch(['o1']);
    edits.reconcile(model(100.5));
    expect(edits.has('line')).toBe(false);
  });

  it('drops edits on failure, on timeout and when their line is gone', () => {
    const edits = new TradingEdits();
    edits.begin('a', { price: 1 }, ['o1']);
    edits.begin('b', { removing: true }, ['o2']);
    edits.begin('c', { removing: true }, ['p1']);
    edits.fail('a');
    expect(edits.expire('o2')).toEqual(['b']);
    edits.reconcile([]);
    expect(edits.size).toBe(0);
  });

  it('treats a resync as an answer to every edit', () => {
    const edits = new TradingEdits();
    edits.begin('line', { price: 101 }, ['o1']);
    edits.settle('line');
    edits.touch();
    edits.reconcile(model(100));
    expect(edits.size).toBe(0);
  });
});

describe('runTradingAction', () => {
  it('sends each action through the session', async () => {
    const feed = new MockFeed({ autoTick: false });
    const broker = new MockBroker({ feed });
    const session = new BrokerSession(broker);
    await session.start();
    await feed.setQuote('MOCK:ACME', { bid: 100, ask: 100.02 });
    const id = await session.submitOrder({ instrument: 'MOCK:ACME', side: 'buy', kind: 'limit', quantity: 5, limitPrice: 99, stopLoss: 98 });
    await broker.idle();

    await runTradingAction(session, { type: 'amend-order', orderId: id, changes: { limitPrice: 99.25 } });
    await broker.idle();
    expect(session.getOrder(id)?.limitPrice).toBe(99.25);

    await runTradingAction(session, { type: 'amend-order', orderId: id, changes: { stopLoss: 97.5 } });
    await broker.idle();
    expect(session.orders.find((o) => o.exitRole === 'stop-loss' && o.state === 'held')?.stopPrice).toBe(97.5);

    await runTradingAction(session, { type: 'cancel-order', orderId: id });
    await broker.idle();
    expect(session.getOrder(id)?.state).toBe('cancelled');
    await session.stop();
    feed.dispose();
  });
});
