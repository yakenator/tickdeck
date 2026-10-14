# @tickdeck/datafeed

The market data contract a host application implements (`MarketFeed`), timeframe helpers, an order book helper, and two ready-made feeds: a deterministic `MockFeed` and a configurable `HttpPollingFeed`.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/datafeed
```

## The `MarketFeed` contract

| Member | Purpose |
|---|---|
| `getCapabilities()` | Timeframes, search filters (kinds, venues), and whether search, depth and server time exist |
| `findInstruments(query)` | Text search with optional kind, venue, limit and offset |
| `getInstrument(id, options?)` | Instrument metadata (`Instrument` from `@tickdeck/core`); `extendedHours` selects the extended session |
| `loadHistory(request)` | One page of bars, see below |
| `streamBars(request, listener)` | Live updates of the newest bar, plus `onHistoryChanged` when past bars changed |
| `loadQuotes(ids)`, `streamQuotes(request, onQuotes)` | Quote snapshots and updates; `focus` instruments update promptly, the rest at a relaxed pace |
| `streamDepth?(id, onDepth)` | Order book: a `snapshot`, then `delta`s where `size: 0` removes a level |
| `loadServerTime?()` | The server clock |

Conventions:

- Requests return promises and reject with `FeedError` (`code`: `not-found`, `unsupported`, `invalid-request`, `network`, `bad-response`).
- Streams return an `Unsubscribe` function. Listeners are always called asynchronously, never from inside the subscribing call.
- Times are UTC epoch milliseconds.

### History paging

`loadHistory({ instrument, timeframe, from, to, count?, firstPage })` asks for bars with `from <= time < to`. When `count` is set, return at least that many bars before `to`, going back past `from` if needed. The page holds bars in ascending order and may set:

- `endOfHistory: true`: nothing exists before the oldest bar returned, so tickdeck stops paging back;
- `olderBarTime`: when `bars` is empty because of a gap, the time of the newest older bar.

### Timeframes

A positive count plus a case-sensitive unit: `t` ticks, `s` seconds, `m` minutes, `h` hours, `D` days, `W` weeks, `M` months (`100t`, `15s`, `5m`, `4h`, `1D`, `1W`, `3M`). Helpers: `parseTimeframe`, `tryParseTimeframe`, `formatTimeframe`, `timeframeDuration`, `compareTimeframes`, `barOpenTime` and `nextBarOpenTime` (UTC alignment, Monday weeks, calendar months).

### Depth

`DepthBook` applies snapshots and deltas and exposes `bids` (best first), `asks`, `bestBid` and `bestAsk`. `diffDepth(previous, next)` produces a delta between two snapshots.

## `MockFeed`

Seeded, deterministic data for development, demos and tests. Prices follow a random walk; any timeframe can be generated, and bars at different timeframes agree exactly (an hour bar equals its sixty minute bars). Realtime bars, quotes and depth continue the same path.

```ts
import { MockFeed } from '@tickdeck/datafeed';

const feed = new MockFeed({ seed: 42 });            // MOCK:ACME, MOCK:BTCUSD, MOCK:EURUSD, MOCK:ES
const page = await feed.loadHistory({ instrument: 'MOCK:ACME', timeframe: '5m', from, to, firstPage: true });

// In tests: no timer, drive prices by hand.
const manual = new MockFeed({ autoTick: false });
await manual.setQuote('MOCK:ACME', { bid: 99.4, ask: 99.48 });
await manual.tick();
```

Options include `instruments`, `historyStart` (default 2024-01-01), `scheduler`, `tickIntervalMs`, `relaxedQuoteIntervalMs` and `depthLevels`. Simulated instruments trade around the clock.

## `HttpPollingFeed`

A `MarketFeed` over a small JSON API, polling for realtime data. Paths and decoders can be replaced to front other REST services, and `fetch` can be injected.

```ts
import { HttpPollingFeed } from '@tickdeck/datafeed';

const feed = new HttpPollingFeed({
  baseUrl: 'https://example.com/api/feed',
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  paths: { history: 'v2/bars' },
  onError: (error, endpoint) => report(error, endpoint),
});
```

Default endpoints, all `GET`, relative to `baseUrl`:

| Path | Query | Response |
|---|---|---|
| `capabilities` | | `FeedCapabilities` |
| `search` | `text`, `kind`, `venue`, `limit`, `offset` | `InstrumentMatch[]` |
| `instrument` | `id`, `extendedHours` | `Instrument` |
| `history` | `instrument`, `timeframe`, `from`, `to`, `count`, `firstPage` | `{ bars: Bar[], endOfHistory?, olderBarTime?, revision? }` |
| `quotes` | `instruments` (comma-separated) | `Quote[]` |
| `depth` | `instrument`, `levels` | `{ bids: DepthLevel[], asks: DepthLevel[] }` |
| `time` | | `{ time: number }` |

Bar streams poll `history` every `barPollMs` (5 s) and emit only changed bars; a new `revision` value triggers `onHistoryChanged`. Quote streams poll focus instruments every `focusQuotePollMs` (1 s) and the rest every `quotePollMs` (30 s). Depth streams poll every `depthPollMs` (1 s) and emit a snapshot followed by deltas.

A WebSocket streaming adapter is planned for P2.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
