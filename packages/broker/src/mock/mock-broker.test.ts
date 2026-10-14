import { MockFeed } from '@tickdeck/datafeed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokerSession } from '../session';
import type { BrokerNotice, BrokerOrder, Fill, OrderRequest } from '../types';
import type { AckTimeoutError } from '../watchdog';
import { MockBroker, type MockBrokerOptions } from './mock-broker';

const NOW = Date.UTC(2026, 9, 14, 12, 0, 30);
const ACME = 'MOCK:ACME';

async function setup(options: Partial<MockBrokerOptions> = {}) {
  const feed = new MockFeed({ autoTick: false });
  const broker = new MockBroker({ feed, ...options });
  const session = new BrokerSession(broker);
  const timeouts: AckTimeoutError[] = [];
  const violations: unknown[] = [];
  const notices: BrokerNotice[] = [];
  session.on('timeout', (error) => timeouts.push(error));
  session.on('violation', (problem) => violations.push(problem));
  session.on('notice', (notice) => notices.push(notice));
  await session.start();

  const quote = async (bid: number, ask: number, instrument = ACME) => {
    await feed.setQuote(instrument, { bid, ask });
    await broker.idle();
  };
  const submit = async (request: Omit<OrderRequest, 'instrument'> & { instrument?: string }) => {
    const id = await session.submitOrder({ instrument: ACME, ...request });
    await broker.idle();
    return id;
  };
  const exitsOf = (parentId: string) => session.orders.filter((order) => order.parent?.id === parentId);
  const ofRole = (orders: BrokerOrder[], role: BrokerOrder['exitRole']) => orders.find((o) => o.exitRole === role)!;
  return { feed, broker, session, timeouts, violations, notices, quote, submit, exitsOf, ofRole };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MockBroker with MockFeed, end to end', () => {
  it('fills a limit entry, activates its exits, and closes on take-profit with the stop-loss cancelled', async () => {
    const { broker, session, timeouts, violations, quote, submit, exitsOf, ofRole } = await setup();
    const fills: Fill[] = [];
    session.on('fill', (fill) => fills.push(fill));
    await quote(100.0, 100.02);

    // Place a limit buy below the market with protective exits.
    const entryId = await submit({
      side: 'buy',
      kind: 'limit',
      quantity: 10,
      limitPrice: 99.5,
      takeProfit: 101,
      stopLoss: 98.5,
    });
    expect(session.getOrder(entryId)).toMatchObject({ state: 'open', filledQuantity: 0 });
    const heldExits = exitsOf(entryId);
    expect(heldExits.map((o) => [o.exitRole, o.state, o.kind, o.side, o.quantity])).toEqual([
      ['take-profit', 'held', 'limit', 'sell', 10],
      ['stop-loss', 'held', 'stop', 'sell', 10],
    ]);
    expect(session.positions).toEqual([]);

    // The ask drops through the limit: the resting order fills at its limit price.
    await quote(99.4, 99.48);
    expect(session.getOrder(entryId)).toMatchObject({ state: 'filled', filledQuantity: 10, averageFillPrice: 99.5 });
    expect(session.positions).toHaveLength(1);
    const position = session.positions[0]!;
    expect(position).toMatchObject({
      instrument: ACME,
      side: 'buy',
      quantity: 10,
      averagePrice: 99.5,
      takeProfit: 101,
      stopLoss: 98.5,
      unrealizedPnl: -1,
      lastPrice: 99.4,
    });
    const tp = ofRole(session.orders, 'take-profit');
    const sl = ofRole(session.orders, 'stop-loss');
    for (const exit of [tp, sl]) {
      expect(exit).toMatchObject({ state: 'open', parent: { kind: 'position', id: position.id }, quantity: 10 });
    }
    expect(session.balance.value).toMatchObject({ balance: 100_000, equity: 99_999, unrealizedPnl: -1 });

    // Price rises: unrealized P&L and equity follow the bid.
    await quote(100.0, 100.02);
    expect(session.getPosition(position.id)?.unrealizedPnl).toBe(5);
    expect(session.balance.value).toMatchObject({ balance: 100_000, equity: 100_005 });

    // The bid reaches the take-profit.
    const sequence: string[] = [];
    for (const type of ['fill', 'order', 'position'] as const) {
      session.on(type, (payload) => {
        const detail = 'state' in payload ? `${payload.exitRole}:${payload.state}` : 'quantity' in payload ? `${payload.quantity}` : '';
        sequence.push(`${type}${detail ? ` ${detail}` : ''}`);
      });
    }
    await quote(101.05, 101.07);

    expect(session.getOrder(tp.id)).toMatchObject({ state: 'filled', averageFillPrice: 101 });
    expect(session.getOrder(sl.id)).toMatchObject({ state: 'cancelled' });
    expect(session.positions).toEqual([]);
    expect(sequence).toEqual(['fill 10', 'order take-profit:filled', 'position 0', 'order stop-loss:cancelled']);

    expect(fills.map((f) => [f.orderId, f.side, f.price, f.quantity, f.realizedPnl])).toEqual([
      [entryId, 'buy', 99.5, 10, 0],
      [tp.id, 'sell', 101, 10, 15],
    ]);
    expect(session.fills).toEqual(fills);
    expect(await broker.listFills(ACME)).toEqual(fills);
    expect(session.balance.value).toEqual({
      accountId: 'demo',
      currency: 'USD',
      balance: 100_015,
      equity: 100_015,
      unrealizedPnl: 0,
      realizedPnl: 15,
    });

    await vi.advanceTimersByTimeAsync(11_000);
    expect(timeouts).toEqual([]);
    expect(violations).toEqual([]);
    expect(session.pendingAcks).toEqual([]);
  });

  it('stops out through the stop-loss and cancels the take-profit', async () => {
    const { session, quote, submit, ofRole } = await setup();
    await quote(100.0, 100.02);
    await submit({ side: 'sell', kind: 'market', quantity: 5, takeProfit: 98, stopLoss: 101 });
    expect(session.positions[0]).toMatchObject({ side: 'sell', quantity: 5, averagePrice: 100 });

    await quote(101.0, 101.02);

    expect(ofRole(session.orders, 'stop-loss')).toMatchObject({ state: 'filled', averageFillPrice: 101.02 });
    expect(ofRole(session.orders, 'take-profit').state).toBe('cancelled');
    expect(session.positions).toEqual([]);
    expect(session.balance.value).toMatchObject({ balance: 99_994.9, realizedPnl: -5.1 });
  });
});

describe('MockBroker execution rules', () => {
  it('fills market orders at the ask or bid and charges commission', async () => {
    const { session, quote, submit } = await setup({ commissionPerUnit: 0.01 });
    await quote(50.0, 50.04);

    await submit({ side: 'buy', kind: 'market', quantity: 100 });
    await submit({ side: 'sell', kind: 'market', quantity: 40 });

    expect(session.fills.map((f) => [f.side, f.price, f.commission])).toEqual([
      ['buy', 50.04, 1],
      ['sell', 50, 0.4],
    ]);
    expect(session.positions[0]).toMatchObject({ quantity: 60, averagePrice: 50.04, realizedPnl: -1.6 });
    expect(session.balance.value).toMatchObject({ balance: 99_997, realizedPnl: -1.6 });
  });

  it('fills a marketable limit at the better market price', async () => {
    const { session, quote, submit } = await setup();
    await quote(100.0, 100.02);
    const id = await submit({ side: 'buy', kind: 'limit', quantity: 1, limitPrice: 100.5 });
    expect(session.getOrder(id)).toMatchObject({ state: 'filled', averageFillPrice: 100.02 });
  });

  it('triggers stop and stop-limit orders when the market reaches the stop', async () => {
    const { session, quote, submit } = await setup();
    await quote(100.0, 100.02);
    const stop = await submit({ side: 'buy', kind: 'stop', quantity: 1, stopPrice: 101 });
    const stopLimit = await submit({ side: 'buy', kind: 'stop-limit', quantity: 1, stopPrice: 101, limitPrice: 101.2 });

    await quote(100.9, 100.98);
    expect(session.getOrder(stop)?.state).toBe('open');

    await quote(101.4, 101.5);
    expect(session.getOrder(stop)).toMatchObject({ state: 'filled', averageFillPrice: 101.5 });
    expect(session.getOrder(stopLimit)?.state).toBe('open');

    await quote(101.1, 101.15);
    expect(session.getOrder(stopLimit)).toMatchObject({ state: 'filled', averageFillPrice: 101.2 });
  });

  it('cancels immediate-or-cancel orders that cannot fill on arrival', async () => {
    const { session, quote, submit } = await setup();
    await quote(100.0, 100.02);
    const id = await submit({ side: 'buy', kind: 'limit', quantity: 1, limitPrice: 99, timeInForce: 'ioc' });
    expect(session.getOrder(id)).toMatchObject({ state: 'cancelled', message: 'Could not fill immediately' });
  });

  it('rejects invalid orders with a reason and a notice', async () => {
    const { session, quote, submit, notices } = await setup();
    await quote(100.0, 100.02);

    const offStep = await submit({ side: 'buy', kind: 'market', quantity: 1.5 });
    const badExits = await submit({ side: 'buy', kind: 'limit', quantity: 1, limitPrice: 99, takeProfit: 98, stopLoss: 97 });
    const offTick = await submit({ side: 'buy', kind: 'limit', quantity: 1, limitPrice: 99.005 });
    const unknown = await session.submitOrder({ instrument: 'NOPE', side: 'buy', kind: 'market', quantity: 1 });
    await settle(session);

    expect(session.getOrder(offStep)).toMatchObject({ state: 'rejected', message: 'Quantity 1.5 is not a multiple of the quantity step' });
    expect(session.getOrder(badExits)?.message).toBe('Take-profit must be above the entry price');
    expect(session.getOrder(offTick)?.message).toBe('Limit price 99.005 is not on the tick size 0.01');
    expect(session.getOrder(unknown)).toMatchObject({ state: 'rejected', message: 'Unknown instrument NOPE' });
    expect(await session.getTradingRules('NOPE')).toMatchObject({ tradable: false });
    expect(notices.filter((n) => n.level === 'error')).toHaveLength(4);
  });
});

describe('MockBroker positions and exits', () => {
  it('closes part of a position, resizing its exits, then the rest', async () => {
    const { session, quote, submit, ofRole } = await setup();
    await quote(100.0, 100.02);
    await submit({ side: 'buy', kind: 'market', quantity: 10, takeProfit: 105, stopLoss: 95 });
    const positionId = session.positions[0]!.id;

    await quote(101.0, 101.02);
    await session.closePosition(positionId, 4);
    await settle(session);

    expect(session.getPosition(positionId)).toMatchObject({ quantity: 6, realizedPnl: 3.92 });
    expect(ofRole(session.orders, 'take-profit')).toMatchObject({ state: 'open', quantity: 6 });
    expect(ofRole(session.orders, 'stop-loss')).toMatchObject({ state: 'open', quantity: 6 });

    await session.closePosition(positionId);
    await settle(session);
    expect(session.positions).toEqual([]);
    expect(ofRole(session.orders, 'take-profit').state).toBe('cancelled');
    expect(ofRole(session.orders, 'stop-loss').state).toBe('cancelled');
    expect(session.balance.value).toMatchObject({ balance: 100_009.8, equity: 100_009.8 });
  });

  it('reverses a position and drops its exits', async () => {
    const { session, quote, submit, ofRole } = await setup();
    await quote(100.0, 100.02);
    await submit({ side: 'buy', kind: 'market', quantity: 10, stopLoss: 95 });
    const positionId = session.positions[0]!.id;

    await session.reversePosition(positionId);
    await settle(session);

    expect(session.positions).toEqual([
      expect.objectContaining({ id: positionId, side: 'sell', quantity: 10, averagePrice: 100 }),
    ]);
    expect(ofRole(session.orders, 'stop-loss').state).toBe('cancelled');
    expect(session.balance.value?.realizedPnl).toBe(-0.2);
  });

  it('sets, moves and removes exits on a position, with OCO on fill', async () => {
    const { session, quote, submit, ofRole } = await setup();
    await quote(100.0, 100.02);
    await submit({ side: 'buy', kind: 'market', quantity: 2 });
    const positionId = session.positions[0]!.id;

    await session.setPositionExits(positionId, { takeProfit: 103, stopLoss: 98 });
    await settle(session);
    expect(session.getPosition(positionId)).toMatchObject({ takeProfit: 103, stopLoss: 98 });

    await session.setPositionExits(positionId, { stopLoss: 99, takeProfit: null });
    await settle(session);
    expect(session.getPosition(positionId)).toMatchObject({ stopLoss: 99, takeProfit: undefined });
    expect(ofRole(session.orders, 'take-profit').state).toBe('cancelled');

    await session.setPositionExits(positionId, { takeProfit: 102 });
    await settle(session);
    await quote(98.9, 98.92);

    const stops = session.orders.filter((o) => o.exitRole === 'stop-loss');
    expect(stops.map((o) => [o.state, o.stopPrice, o.averageFillPrice])).toEqual([['filled', 99, 98.9]]);
    expect(session.orders.filter((o) => o.exitRole === 'take-profit').map((o) => o.state)).toEqual(['cancelled', 'cancelled']);
    expect(session.positions).toEqual([]);
  });

  it('cancels held exits together with their entry and amends them through it', async () => {
    const { session, quote, submit, exitsOf, ofRole } = await setup();
    await quote(100.0, 100.02);
    const entry = await submit({ side: 'buy', kind: 'limit', quantity: 3, limitPrice: 99, takeProfit: 102, stopLoss: 97 });

    await session.amendOrder(entry, { takeProfit: 103, stopLoss: null, quantity: 4 });
    await settle(session);
    expect(session.getOrder(entry)).toMatchObject({ quantity: 4, takeProfit: 103, stopLoss: undefined });
    expect(ofRole(exitsOf(entry), 'take-profit')).toMatchObject({ state: 'held', limitPrice: 103, quantity: 4 });
    expect(ofRole(exitsOf(entry), 'stop-loss').state).toBe('cancelled');

    await session.cancelOrder(entry);
    await settle(session);
    expect(session.getOrder(entry)?.state).toBe('cancelled');
    expect(exitsOf(entry).every((o) => o.state === 'cancelled')).toBe(true);
  });

  it('fills an order amended into the market', async () => {
    const { session, quote, submit } = await setup();
    await quote(100.0, 100.02);
    const id = await submit({ side: 'sell', kind: 'limit', quantity: 1, limitPrice: 101 });
    await session.amendOrder(id, { limitPrice: 99.9 });
    await settle(session);
    expect(session.getOrder(id)).toMatchObject({ state: 'filled', averageFillPrice: 100, limitPrice: 99.9 });
  });

  it('issues confirmation tokens from order checks', async () => {
    const { session, quote } = await setup();
    await quote(100.0, 100.02);
    const check = await session.checkOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 3 });
    expect(check).toMatchObject({ estimates: { cost: 300.06, commission: 0 }, errors: [] });

    const id = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 3 }, check.confirmationToken);
    const reused = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 3 }, check.confirmationToken);
    await settle(session);
    expect(session.getOrder(id)?.state).toBe('filled');
    expect(session.getOrder(reused)).toMatchObject({ state: 'rejected', message: 'Unknown or used confirmation token' });
  });

  it('keeps accounts apart and reports only the active one', async () => {
    const { feed, quote } = await setup();
    const broker = new MockBroker({
      feed,
      accounts: [
        { id: 'a', name: 'A', currency: 'USD' },
        { id: 'b', name: 'B', currency: 'USD' },
      ],
    });
    const session = new BrokerSession(broker);
    await session.start();
    await quote(100.0, 100.02);
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'market', quantity: 1 });
    await broker.idle();
    expect(session.positions).toHaveLength(1);

    await session.switchAccount('b');
    await broker.idle();
    expect(session.activeAccountId.value).toBe('b');
    expect(session.positions).toEqual([]);
    expect(session.orders).toEqual([]);
    expect(session.capabilities.multipleAccounts).toBe(true);

    await session.switchAccount('a');
    expect(session.positions).toHaveLength(1);
  });
});

async function settle(session: BrokerSession): Promise<void> {
  await (session.connector as MockBroker).idle();
}
