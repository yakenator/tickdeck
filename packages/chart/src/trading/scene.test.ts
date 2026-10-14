import { BrokerSession, MockBroker, type BrokerOrder, type BrokerPosition, type Fill } from '@tickdeck/broker';
import type { Bar, Instrument } from '@tickdeck/core';
import { MockFeed } from '@tickdeck/datafeed';
import { describe, expect, it } from 'vitest';
import { buildTradingScene, fillBarTime, formatPositionPnl, positionPnl, type TradingSceneInput } from './scene';

const ES: Instrument = {
  id: 'MOCK:ES',
  name: 'ES',
  kind: 'futures',
  timezone: 'Etc/UTC',
  session: 'always',
  tickSize: 0.25,
  pricePrecision: 2,
  quantity: { min: 1, step: 1 },
  pointValue: 50,
  currency: 'USD',
};

const caps = { amendOrders: true, positionExits: true };
const MINUTE = 60_000;
const bar = (time: number, close = 4500): Bar => ({ time, open: close, high: close, low: close, close });

const order = (fields: Partial<BrokerOrder> & Pick<BrokerOrder, 'id'>): BrokerOrder => ({
  instrument: ES.id,
  side: 'buy',
  kind: 'limit',
  quantity: 2,
  state: 'open',
  filledQuantity: 0,
  ...fields,
});

const position = (fields: Partial<BrokerPosition> = {}): BrokerPosition => ({
  id: 'p1',
  instrument: ES.id,
  side: 'buy',
  quantity: 2,
  averagePrice: 4500,
  ...fields,
});

const scene = (input: Partial<TradingSceneInput>) =>
  buildTradingScene({ instrument: ES, orders: [], positions: [], fills: [], capabilities: caps, ...input });

const summary = (input: Partial<TradingSceneInput>) =>
  scene(input).lines.map((line) => [line.id, line.label, line.price]);

describe('buildTradingScene: orders', () => {
  it('draws working orders at their prices and skips market, final and foreign orders', () => {
    const lines = summary({
      orders: [
        order({ id: 'o1', limitPrice: 4500, filledQuantity: 1 }),
        order({ id: 'o2', side: 'sell', kind: 'stop', stopPrice: 4490 }),
        order({ id: 'o3', kind: 'stop-limit', stopPrice: 4510, limitPrice: 4511 }),
        order({ id: 'o4', kind: 'market', state: 'pending' }),
        order({ id: 'o5', limitPrice: 4400, state: 'filled', filledQuantity: 2 }),
        order({ id: 'o6', limitPrice: 99, instrument: 'MOCK:ACME' }),
      ],
    });
    expect(lines).toEqual([
      ['order:o1', 'BUY LMT 1', 4500],
      ['order:o2', 'SELL STP 2', 4490],
      ['order:o3', 'BUY STP LMT 2', 4510],
      ['order:o3:limit', 'LMT 2', 4511],
    ]);
  });

  it('targets the right price field and only lets the main stop-limit line cancel', () => {
    const [stop, limit] = scene({ orders: [order({ id: 'o3', kind: 'stop-limit', stopPrice: 4510, limitPrice: 4511 })] }).lines;
    expect(stop?.target).toEqual({ type: 'order', orderId: 'o3', field: 'stopPrice' });
    expect(limit?.target).toEqual({ type: 'order', orderId: 'o3', field: 'limitPrice' });
    expect([stop?.removable, limit?.removable]).toEqual([true, false]);
    expect(scene({ orders: [order({ id: 'o1', limitPrice: 1 })], capabilities: { amendOrders: false, positionExits: false } }).lines[0]?.draggable).toBe(false);
  });

  it('shows exits of entry orders once, preferring the exit order over the requested level', () => {
    const lines = scene({
      orders: [
        order({ id: 'o1', limitPrice: 4500, takeProfit: 4520, stopLoss: 4480 }),
        order({ id: 'x1', side: 'sell', state: 'held', limitPrice: 4521, exitRole: 'take-profit', parent: { kind: 'order', id: 'o1' } }),
      ],
    }).lines;
    expect(lines.map((line) => [line.id, line.kind, line.label, line.price, line.side])).toEqual([
      ['order:o1', 'order', 'BUY LMT 2', 4500, 'buy'],
      ['exit:order:o1:take-profit', 'take-profit', 'TP 2', 4521, 'sell'],
      ['exit:order:o1:stop-loss', 'stop-loss', 'SL 2', 4480, 'sell'],
    ]);
    expect(lines[1]?.target).toEqual({ type: 'order-exit', entryOrderId: 'o1', role: 'take-profit', exitOrderId: 'x1' });
    expect(lines[2]?.target).toEqual({ type: 'order-exit', entryOrderId: 'o1', role: 'stop-loss', exitOrderId: undefined });
  });

  it('shows exit orders whose parent is unknown as plain orders', () => {
    const [line] = scene({
      orders: [order({ id: 'x9', side: 'sell', kind: 'stop', stopPrice: 4470, exitRole: 'stop-loss', parent: { kind: 'position', id: 'gone' } })],
    }).lines;
    expect(line).toMatchObject({ id: 'order:x9', kind: 'stop-loss', group: 'positions', label: 'SL 2', price: 4470 });
    expect(line?.target).toEqual({ type: 'order', orderId: 'x9', field: 'stopPrice' });
  });
});

describe('buildTradingScene: positions', () => {
  it('draws a position at its average price with P&L and its exits', () => {
    const lines = scene({
      positions: [position({ stopLoss: 4480, unrealizedPnl: 250, lastPrice: 4502.5 })],
      orders: [order({ id: 'x1', side: 'sell', limitPrice: 4520, exitRole: 'take-profit', parent: { kind: 'position', id: 'p1' } })],
    }).lines;
    expect(lines.map((line) => [line.id, line.label, line.price, line.draggable, line.removable])).toEqual([
      ['position:p1', 'LONG 2', 4500, false, true],
      ['exit:position:p1:take-profit', 'TP 2', 4520, true, true],
      ['exit:position:p1:stop-loss', 'SL 2', 4480, true, true],
    ]);
    expect(lines[0]?.pnl).toMatchObject({ money: 250, ticks: 10, currency: 'USD' });
    expect(lines[0]?.pnl?.percent).toBeCloseTo(0.0556, 4);
    expect(lines[1]?.target).toEqual({ type: 'position-exit', positionId: 'p1', role: 'take-profit', exitOrderId: 'x1' });
  });

  it('can only move position exits that have an exit order when the broker lacks position exits', () => {
    const lines = scene({
      capabilities: { amendOrders: true, positionExits: false },
      positions: [position({ stopLoss: 4480 })],
      orders: [order({ id: 'x1', side: 'sell', limitPrice: 4520, exitRole: 'take-profit', parent: { kind: 'position', id: 'p1' } })],
    }).lines;
    expect(lines.slice(1).map((line) => [line.kind, line.draggable, line.removable])).toEqual([
      ['take-profit', true, true],
      ['stop-loss', false, false],
    ]);
  });

  it('marks positions from the last bar when the broker reports no P&L', () => {
    const bars = [bar(0, 4490), bar(MINUTE, 4510)];
    expect(positionPnl(position(), ES, 4510)).toMatchObject({ money: 1000, ticks: 40 });
    const [long] = scene({ positions: [position()], bars }).lines;
    expect(long?.pnl).toMatchObject({ money: 1000, ticks: 40 });
    const [short] = scene({ positions: [position({ side: 'sell' })], bars }).lines;
    expect(short?.label).toBe('SHORT 2');
    expect(short?.pnl).toMatchObject({ money: -1000, ticks: -40 });
    expect(short?.pnl?.percent).toBeCloseTo(-0.2222, 4);
    expect(scene({ positions: [position()] }).lines[0]?.pnl).toEqual({ currency: 'USD', money: undefined });
  });

  it('formats P&L in the requested units', () => {
    const pnl = { money: -1000, ticks: -40, percent: -0.2222, currency: 'USD' };
    expect(formatPositionPnl(pnl)).toBe('-1000.00 USD');
    expect(formatPositionPnl(pnl, ['money', 'ticks', 'percent'])).toBe('-1000.00 USD · -40 ticks · -0.22%');
    expect(formatPositionPnl({ currency: 'USD' })).toBeUndefined();
    expect(formatPositionPnl(pnl, ['money'], (value, currency) => `${currency} ${value}`)).toBe('USD -1000');
  });
});

describe('buildTradingScene: visibility, edits and fills', () => {
  const orders = [order({ id: 'o1', limitPrice: 4500, takeProfit: 4520 })];
  const positions = [position({ stopLoss: 4480 })];

  it('hides groups that are switched off', () => {
    const ids = (visibility: TradingSceneInput['visibility']) => scene({ orders, positions, visibility }).lines.map((l) => l.id);
    expect(ids({ orders: false, positions: true, fills: true })).toEqual(['position:p1', 'exit:position:p1:stop-loss']);
    expect(ids({ orders: true, positions: false, fills: true })).toEqual(['order:o1', 'exit:order:o1:take-profit']);
  });

  it('shows unconfirmed edits as pending', () => {
    const lines = scene({
      orders,
      edits: new Map([
        ['order:o1', { price: 4501 }],
        ['exit:order:o1:take-profit', { removing: true }],
      ]),
    }).lines;
    expect(lines.map((line) => [line.price, line.pending])).toEqual([
      [4501, true],
      [4520, true],
    ]);
  });

  it('places fill markers on the bar they belong to, newest fills first to be kept', () => {
    const fill = (id: string, time: number, side: Fill['side'] = 'buy'): Fill => ({ id, instrument: ES.id, side, price: 4500, quantity: 1, time });
    const bars = [bar(10 * MINUTE), bar(11 * MINUTE), bar(12 * MINUTE)];
    const fills = [
      fill('f0', 9 * MINUTE),
      fill('f1', 10 * MINUTE + 5_000),
      fill('f2', 12 * MINUTE + 59_000, 'sell'),
      fill('f3', 30 * MINUTE),
      { ...fill('f4', 11 * MINUTE), instrument: 'MOCK:ACME' },
    ];
    expect(scene({ fills, bars }).fills.map((m) => [m.fillId, m.time / MINUTE, m.side])).toEqual([
      ['f1', 10, 'buy'],
      ['f2', 12, 'sell'],
      ['f3', 12, 'buy'],
    ]);
    expect(scene({ fills, bars, maxFills: 2 }).fills.map((m) => m.fillId)).toEqual(['f2', 'f3']);
    expect(scene({ fills, bars, visibility: { orders: true, positions: true, fills: false } }).fills).toEqual([]);
    expect(fillBarTime(5, [])).toBeUndefined();
  });
});

describe('buildTradingScene with a MockBroker session', () => {
  it('follows an order through fill, position and take-profit', async () => {
    const feed = new MockFeed({ autoTick: false });
    const broker = new MockBroker({ feed });
    const session = new BrokerSession(broker);
    await session.start();
    const acme = await feed.getInstrument('MOCK:ACME');
    const bars = [bar(Date.now() - 3_600_000, 100)];
    const current = () =>
      buildTradingScene({
        instrument: acme,
        orders: session.orders,
        positions: session.positions,
        fills: session.fills,
        capabilities: session.capabilities,
        bars,
      });

    await feed.setQuote(acme.id, { bid: 100, ask: 100.02 });
    await session.submitOrder({ instrument: acme.id, side: 'buy', kind: 'limit', quantity: 10, limitPrice: 99.5, takeProfit: 101, stopLoss: 98.5 });
    await broker.idle();
    expect(current().lines.map((line) => [line.kind, line.label, line.price])).toEqual([
      ['order', 'BUY LMT 10', 99.5],
      ['take-profit', 'TP 10', 101],
      ['stop-loss', 'SL 10', 98.5],
    ]);

    await feed.setQuote(acme.id, { bid: 99.4, ask: 99.48 });
    await broker.idle();
    const filled = current();
    expect(filled.lines.map((line) => [line.kind, line.label, line.price])).toEqual([
      ['position', 'LONG 10', 99.5],
      ['take-profit', 'TP 10', 101],
      ['stop-loss', 'SL 10', 98.5],
    ]);
    expect(filled.lines[0]?.pnl?.money).toBe(-1);
    expect(filled.fills).toHaveLength(1);

    await feed.setQuote(acme.id, { bid: 99.9, ask: 99.92 });
    await broker.idle();
    expect(current().lines[0]?.pnl?.money).toBe(4);

    await feed.setQuote(acme.id, { bid: 101.02, ask: 101.04 });
    await broker.idle();
    const closed = current();
    expect(closed.lines).toEqual([]);
    expect(closed.fills.map((marker) => marker.side)).toEqual(['buy', 'sell']);
    await session.stop();
    feed.dispose();
  });
});
