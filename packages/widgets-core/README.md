# @tickdeck/widgets-core

Headless controllers behind the tickdeck trading widgets: the account panel, order ticket, trade buttons and notifications. Each one holds observable state, validates input, computes derived values and sends commands through a `BrokerSession`. There is no DOM access, so the controllers run in Node, workers and tests, and you can drive your own UI from them.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/widgets-core @tickdeck/broker @tickdeck/datafeed
```

## Context

Every controller takes a `WidgetContext`:

| Field | Purpose |
|---|---|
| `session` | A started `BrokerSession`. Controllers read orders, positions, fills, balance and capabilities from it and send every action through it, never to the connector directly. |
| `feed` | Optional. Quotes for live bid and ask (`QuoteSource`), plus `getInstrument` for display names and precision. Any `MarketFeed` fits. |
| `scheduler` | Optional clock and timers, for auto-dismiss and confirmation windows. Defaults to the host's. |
| `timeZone` | Optional IANA timezone for displayed times. Defaults to the host's. |

## Controller shape

All controllers extend `WidgetController<State, Events>`:

- `state`: a read-only `ObservableValue` from `@tickdeck/core`. State objects are replaced on every change, never mutated. Use `state.value` and `state.subscribe(listener)` (or the `subscribe` shorthand).
- Action methods: they change state or send broker commands. Commands resolve once the broker confirmed them and never throw for broker problems; failures land in the state (`result`, `error`) and in an event.
- `on(event, listener)` / `once`: typed events for things the application must react to.
- `dispose()`: releases subscriptions and timers.

```ts
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { AccountPanelController, OrderTicketController } from '@tickdeck/widgets-core';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

const ticket = new OrderTicketController({ session, feed }, { instrument: 'MOCK:ACME', kind: 'limit' });
const panel = new AccountPanelController({ session, feed });
panel.on('amend', (order) => ticket.amend(order));

ticket.subscribe((state) => render(state));
await ticket.ready;
ticket.setQuantity(10);
ticket.setLimitPrice(99.5);
ticket.setExitTicks('takeProfit', 150);
ticket.setExitPrice('stopLoss', 98.5);
await ticket.submit(); // true once the broker confirmed the order
```

## `AccountPanelController`

Orders, positions and fills of the active account with a balance summary.

| State | Meaning |
|---|---|
| `status` | `connecting` (while the session connects), `loading` (until the account is loaded), `ready` or `disconnected`, with the connection's `message` |
| `summary` | Account name and currency, plus `items`: balance, equity, unrealized and realized P&L, margin when reported. Each has `text` and a `tone` |
| `tab`, `orderFilter`, `sort` | Selected tab (`orders`, `positions`, `fills`), `working` or `all` orders, and the sort column and direction per tab |
| `columns` | Column ids, labels and alignment per tab |
| `orders`, `positions`, `fills` | Rows: the broker object as `item`, display `cells` and `tones` per column, a `label` for assistive text, `busy`, and the actions allowed (`canCancel`, `canAmend`, `canClose`, `canPartialClose`, `canReverse`, `canEditExits`). Exits waiting for their entry follow it and carry `parentId` |
| `counts` | Working orders, open positions and listed fills |
| `closing` | A close being entered: position, quantity, maximum and validation error |
| `error` | Message of the last failed action |

Actions: `setTab`, `setOrderFilter`, `sortBy(column)` (again to flip), `cancelOrder(id)`, `requestAmend(id)`, `closePosition(id, quantity?)`, `beginClose(id)`, `setCloseQuantity(q)`, `confirmClose()`, `cancelClose()`, `reversePosition(id)`, `requestEditExits(id)`, `setPositionExits(id, exits)`, `clearError()`.

Events: `amend` (a working order to open in a ticket), `edit-exits` (a position whose take-profit or stop-loss to edit), `action-error` (`{ action, targetId, error, message }`).

Prices and quantities are formatted with the instrument's precision; P&L and balances with the currency's digits. Close and reverse use native broker support when the capabilities say so, and otherwise the session's emulation.

## `OrderTicketController`

Order entry for one instrument.

- **Fields**: `setInstrument`, `setSide`, `setKind` (`market`, `limit`, `stop`, `stop-limit`), `setQuantity`, `stepQuantity(±n)`, `setLimitPrice`, `setStopPrice`, `stepPrice(field, ±n)`, `usePrice(price)` (fills the main price field, for example from a clicked bid or ask), `setTimeInForce`, `setExpiresAt`.
- **Exits**: `setExitEnabled(field, on)`, `setExitMode(field, 'price' | 'ticks')`, `setExitPrice`, `setExitTicks`, where `field` is `takeProfit` or `stopLoss`. Distances in ticks become prices on the profitable or protective side of the entry. For market orders they are measured from the ask (buy) or bid (sell) and follow the quote.
- **Validation** (`errors`, and `visibleErrors` for fields the user touched or after a submit attempt): quantity against the minimum, maximum and step; prices on the tick size, with the nearest valid price; a buy stop above the ask and a sell stop below the bid; exits on the correct side of the entry; a future expiry for `gtd`. Marketable limits and inverted stop-limits produce `warnings`. Order kinds and durations are those both the broker and the instrument allow.
- **Estimates**: notional value, margin (when the rules have a margin rate), risk to the stop-loss and reward to the take-profit, in the instrument's currency.
- **Submitting**: `submit()` sends the order and waits for the broker's acknowledgement (`phase: 'submitting'`, `busy`). With `checkOrders` (default: the broker's `orderCheck` capability) it first calls `checkOrder` and moves to `phase: 'review'` with the broker's estimates and warnings; `confirm()` sends the order with the confirmation token and `cancelReview()` goes back. Rejections, thrown errors and `AckTimeoutError` end up in `result` and in the `error` event.
- **Amend mode**: `amend(order)` loads a working order; side, kind and instrument are locked, and `submit()` sends only the changed fields (`null` removes an exit). `cancelAmend()` leaves it. If the order ends meanwhile, the ticket leaves amend mode with an info `result`.
- **Availability**: `availability` is `no-instrument`, `loading`, `ready`, `connecting`, `disconnected`, `not-tradable` or `error`, with a `reason` (`Connecting to the broker…` while the session connects).

Events: `placed` (`{ orderId, request }`), `amended` (`{ orderId, changes }`), `error` (`{ action: 'check' | 'submit' | 'amend', error, message }`).

Options: `instrument`, `side`, `kind`, `quantity`, `timeInForce`, `checkOrders`, `exitMode`.

## `TradeButtonsController`

One-click market orders with live bid, ask and spread.

- State: `buy` and `sell` views (`price`, `priceText`, `enabled`, `reason`, `description`), `quote`, `quantity` and `quantityError`, `armed` and `busy` sides, `result`, `availability` and `reason`.
- Actions: `setInstrument`, `setQuantity`, `stepQuantity`, `buy()`, `sell()`, `trade(side)`. With `confirm: true`, `trade` only arms a side; `confirmTrade()` sends it and `cancelTrade()` disarms. An armed side disarms itself after `confirmTimeoutMs` (10 s).
- A side is disabled, with a reason, while connecting or disconnected, loading, not tradable, without market orders, with an invalid quantity, without a price on its side, or while an order is in flight.
- Events: `placed`, `error`.

## `NotificationCenter`

Toasts and an in-memory log built from session activity:

| Source | Notification |
|---|---|
| `notice` | Broker notices, with their level |
| `fill` | `Order filled` (or `Take-profit filled`, `Stop-loss filled`) with quantity, price and realized P&L |
| `rejection` | `Order rejected` with the order and the broker's reason (a matching error notice is not shown twice) |
| `timeout` | `No confirmation from the broker` for an `AckTimeoutError` |
| `violation` | `Ignored an inconsistent order update` |
| `connection` | `Connection to the broker lost`, `Reconnected`, and `Could not connect to the broker` when the session fails to start |

State: `toasts` (on screen, oldest first), `log` (newest first, up to `logLimit`), `paused`. Actions: `push(input)` for your own messages, `dismiss(id)`, `dismissAll()`, `clearLog()`, `pause()` and `resume()` (hold auto-dismiss while the user reads). Events: `notification`, `dismiss`.

Options: `durations` per level (info and success 5 s, warning 8 s, error 10 s; 0 keeps a toast), `maxToasts` (4), `logLimit` (100), `sources` (turn sources off).

## Helpers

- `InstrumentResolver` and `getInstrumentResolver(context)`: trading rules merged with feed metadata as a `TradableInstrument` (name, tick size, price and quantity precision, point value, currency), cached per session and cleared when the account changes. `InstrumentFormat` formats prices, quantities and money for one instrument.
- `placeOrder(session, request, token?)`, `runAcknowledged(session, action, id, call)` and `awaitAcknowledgement(session, action, id)`: send through the session and wait for the confirming update. They reject with `AckTimeoutError` or `OrderRejectedError`.
- `describeTradingError(error)`: a short message for any error a trading action can raise.
- `formatAmount`, `formatInputNumber`, `parseInputNumber`, `formatTimeOfDay`, `moneyPrecision`: decimal-exact formatting and parsing.
- Label maps: `SIDE_LABELS`, `POSITION_SIDE_LABELS`, `ORDER_KIND_LABELS`, `TIME_IN_FORCE_LABELS`, `TIME_IN_FORCE_DESCRIPTIONS`, `ORDER_STATE_LABELS`, `EXIT_ROLE_LABELS`.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
