# @tickdeck/broker

The broker adapter contract (requests out, updates in), an order state machine, acknowledgement deadlines, the `BrokerSession` that keeps tickdeck's view of trading state, and a `MockBroker` that simulates execution against any quote stream.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/broker
```

## Two directions

**Requests** go through the `BrokerConnector` the integrator implements:

| Group | Members |
|---|---|
| Connection | `connect(sink)`, `disconnect?()`, `getCapabilities()`, `getConnection()` |
| Accounts | `listAccounts()`, `getActiveAccount()`, `switchAccount?(id)`, `getBalance?()` |
| Snapshots | `listOrders()`, `listPositions()`, `listFills(instrument?)`, `getTradingRules(instrument)` |
| Orders | `submitOrder(request, confirmationToken?)`, `amendOrder(id, changes)`, `cancelOrder(id)`, `checkOrder?(request)` |
| Positions | `closePosition?(id, quantity?)`, `reversePosition?(id)`, `setPositionExits?(id, { takeProfit, stopLoss })` |

**Updates** flow back through the sink passed to `connect`: `sink.emit(type, payload)` with `order`, `position`, `fill`, `pnl`, `balance`, `connection`, `account`, `notice` or `resync`. Orders, positions and fills are sent whole; a position with `quantity: 0` is closed. The integrator's backend stays the source of truth.

## Order lifecycle

States: `pending` → `held` → `open` → `filled` | `cancelled` | `rejected`. Orders only move forward (steps may be skipped), partial fills stay `open`, and final states never change. `canTransition` and `checkOrderUpdate` implement the rules; `BrokerSession` drops updates that break them and emits a `violation` event.

## Acknowledgements

Every action must be confirmed by an update within a deadline (10 s by default):

| Action | Confirming update |
|---|---|
| submit | `order` for the new id, in any state but `pending` |
| amend | any `order` for that order |
| cancel | `order` for that order in a final state |
| close, reverse | `position` for that position |
| set exits | `position` for that position, or `order` for one of its exits |

Otherwise `BrokerSession` emits `timeout` with an `AckTimeoutError` (`action`, `targetId`, `timeoutMs`) and reloads state. `AckWatchdog` is the standalone tracker behind this.

## Protective exits

Take-profit (limit) and stop-loss (stop) orders attached to an entry are `held` with `parent: { kind: 'order' }` until the entry fills. They then become `open` with `parent: { kind: 'position' }` and cover the position. When one fills, the other is cancelled.

## `BrokerSession`

```ts
import { BrokerSession } from '@tickdeck/broker';

const session = new BrokerSession(connector, { ackTimeoutMs: 10_000 });
session.on('order', (order) => render(order));
session.on('timeout', (error) => toast(error.message));
await session.start();

await session.submitOrder({
  instrument: 'MOCK:ACME',
  side: 'buy',
  kind: 'limit',
  quantity: 10,
  limitPrice: 99.5,
  takeProfit: 101,
  stopLoss: 98.5,
});
session.positions;      // open positions
session.balance.value;  // AccountBalance, observable
```

When the connector has no native close or reverse, the session sends a reduce-only market order (close) or a market order for twice the size (reverse), unless the connector sets `emulation: false`.

## `MockBroker`

Simulates a broker against any `QuoteSource`, such as `MockFeed`: market orders at the bid or ask, limit, stop and stop-limit orders as quotes cross, `ioc`/`fok`/`gtd`, exits with OCO, netting positions, partial close, reverse, fills, unrealized P&L, balance and equity, optional commission and latency, and several accounts.

```ts
import { MockFeed } from '@tickdeck/datafeed';
import { BrokerSession, MockBroker } from '@tickdeck/broker';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed, startingBalance: 100_000 }));
await session.start();
```

`applyFillToPosition` and `computeUnrealizedPnl` expose the netting and P&L math.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
