# @tickdeck/core

Shared trading types, decimal-safe price and quantity math, and the small reactive primitives every other tickdeck package builds on. No DOM and no framework dependencies; the only runtime dependency is `decimal.js`.

> Pre-alpha and under construction. APIs will change without notice.

## Install

```sh
npm install @tickdeck/core
```

## API overview

### Domain types

| Type | Meaning |
|---|---|
| `Side` | `'buy' \| 'sell'`, with `oppositeSide` and `sideSign` helpers |
| `OrderKind` | `'market' \| 'limit' \| 'stop' \| 'stop-limit'` |
| `TimeInForce` | `'day' \| 'gtc' \| 'gtd' \| 'ioc' \| 'fok'` |
| `Instrument` | Id, name, kind, venue, currency, IANA `timezone`, `session`, `tickSize`, `pricePrecision`, `quantity` rules (`min`, `max`, `step`) and optional `pointValue` |
| `Bar` | One OHLCV bar; `time` is the open time in UTC epoch milliseconds |
| `Quote`, `QuoteSource` | Quote snapshot and the quote part of the data feed contract (shared with the broker so the mock broker can consume any feed) |

### Price and quantity math

All helpers take and return plain numbers but compute in decimal, so `0.1 + 0.2` problems never reach a price or a P&L figure.

```ts
import { roundToTick, isOnTick, checkQuantity, roundQuantity, addExact } from '@tickdeck/core';

roundToTick(101.2345, 0.01);            // 101.23
roundToTick(4517.13, 0.25, 'up');       // 4517.25
isOnTick(0.1 + 0.2, 0.1);               // true (float noise is tolerated)
checkQuantity(1500, { min: 1000, step: 1000 }); // 'off-step'
roundQuantity(2.9, { min: 0.5, step: 1 });      // 2.5
addExact(0.1, 0.2);                      // 0.3
```

Also: `roundToStep`, `ticksBetween`, `decimalPlaces`, `formatDecimal`, `subtractExact`, `multiplyExact`, `divideExact`.

### Trading sessions

Sessions use a compact syntax evaluated in the instrument's timezone: `always`, or rules such as `Mon-Fri 09:30-16:00`, `Mon-Fri 04:00-09:30,09:30-20:00; Sat 10:00-14:00` or `Sun-Thu 18:00-17:00` (an end at or before the start runs past midnight).

```ts
import { parseSession, isSessionOpen } from '@tickdeck/core';

isSessionOpen('Mon-Fri 09:30-16:00', Date.now(), 'America/New_York');
```

### Primitives

- `Emitter<Events>`: typed events with `on`, `once`, `emit`. A throwing listener does not stop the others.
- `ObservableValue<T>`: a value with `set`, `update` and `subscribe`; `asReadonly()` hands out a read-only view (`ReadonlyObservableValue<T>`).
- `Disposable`, `toDisposable`, `DisposableGroup`: release subscriptions and timers together.
- `Scheduler`, `systemScheduler`: clock and timers, injectable for tests and simulations. `microtask` defers a callback.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
