// A headless strategy on tickdeck's layer 1, in plain Node: MockFeed quotes
// drive MockBroker, and a BrokerSession tracks orders, positions and fills.
// No DOM and no framework. Exits non-zero if the order flow is not as expected.
import assert from 'node:assert/strict';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { VERSION, addExact, formatDecimal, subtractExact } from '@tickdeck/core';
import { MockFeed } from '@tickdeck/datafeed';

const INSTRUMENT = 'MOCK:ACME';
const TICK = 0.01;

// autoTick: false, so prices move only when the strategy says so.
const feed = new MockFeed({ seed: 42, autoTick: false });
const session = new BrokerSession(new MockBroker({ feed, startingBalance: 100_000 }));
const events = [];
session.on('order', (order) => events.push(`order ${order.id} ${order.exitRole ?? 'entry'} ${order.state}`));
session.on('fill', (fill) => events.push(`fill ${fill.side} ${fill.quantity} @ ${fill.price}`));
await session.start();

/** Resolves once `predicate` holds; updates arrive asynchronously. */
async function until(predicate, what) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Moves the market: one tick each side of `last`. */
async function market(last) {
  await feed.setQuote(INSTRUMENT, { bid: subtractExact(last, TICK), ask: addExact(last, TICK), last });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const orders = () => session.orders.filter((order) => order.instrument === INSTRUMENT);
const exits = (role) => orders().find((order) => order.exitRole === role);

// 1. A bracket order: buy 10 at 99.50 with a take-profit at 101.00 and a stop-loss at 99.00.
await market(100);
const entryId = await session.submitOrder({
  instrument: INSTRUMENT,
  side: 'buy',
  kind: 'limit',
  quantity: 10,
  limitPrice: 99.5,
  takeProfit: 101,
  stopLoss: 99,
});
await until(() => session.getOrder(entryId)?.state === 'open', 'the entry to work');
await until(() => exits('take-profit')?.state === 'held' && exits('stop-loss')?.state === 'held', 'the held exits');

// 2. The market trades down through the limit: the entry fills and the exits now protect the position.
await market(99.48);
await until(() => session.getOrder(entryId)?.state === 'filled', 'the entry fill');
await until(() => session.positions.length === 1, 'the position');
const opened = session.positions[0];
assert.equal(opened.side, 'buy');
assert.equal(opened.quantity, 10);
assert.equal(opened.averagePrice, 99.5);
assert.equal(opened.takeProfit, 101);
assert.equal(opened.stopLoss, 99);
await until(() => exits('take-profit')?.state === 'open' && exits('stop-loss')?.state === 'open', 'the working exits');

// 3. The market rallies: unrealized P&L follows (marked at the bid).
await market(100.25);
await until(() => session.positions[0]?.unrealizedPnl === 7.4, 'unrealized P&L of 7.40');
const unrealized = session.positions[0].unrealizedPnl;

// 4. The take-profit fills, the position closes and the stop-loss is cancelled (OCO).
await market(101.02);
await until(() => session.positions.length === 0, 'the position to close');
await until(() => exits('stop-loss')?.state === 'cancelled', 'the stop-loss to be cancelled');
assert.equal(exits('take-profit')?.state, 'filled');
const realized = session.fills.reduce((sum, fill) => addExact(sum, fill.realizedPnl ?? 0), 0);
assert.equal(realized, 15);
const balance = session.balance.value;
assert.equal(balance?.balance, 100_015);

console.log(`tickdeck ${VERSION}: headless bracket order on ${INSTRUMENT}`);
console.log(`  orders     ${orders().map((order) => `${order.exitRole ?? 'entry'}=${order.state}`).join(', ')}`);
console.log(`  fills      ${session.fills.map((fill) => `${fill.side} ${fill.quantity} @ ${formatDecimal(fill.price, 2)}`).join(', ')}`);
console.log(`  unrealized ${formatDecimal(unrealized, 2)} while open`);
console.log(`  realized   ${formatDecimal(realized, 2)}`);
console.log(`  balance    ${formatDecimal(balance.balance, 2)} ${balance.currency}, equity ${formatDecimal(balance.equity, 2)}`);
console.log(`  events     ${events.length} session updates`);

await session.stop();
feed.dispose();
