# tickdeck architecture

> Alpha. P1, the trading MVP, is built as described here. Sections about later phases describe the target design, and names may still change.

## Goals

- Trading UI building blocks that work in any front-end stack: plain HTML, React, Vue or anything that can render a custom element.
- A clean split of ownership. The integrating application owns market data, accounts and order execution. tickdeck owns presentation and interaction.
- Every piece usable on its own and tree-shakable. You pay only for the widgets you import.

### Out of scope for now

Market data and brokerage connectivity (tickdeck connects to yours), a scripting language for custom studies, server-side alerts, strategy backtesting, bar replay and market screeners.

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ 3  Framework wrappers   react, vue                           │  one framework each
├──────────────────────────────────────────────────────────────┤
│ 2  Web Components       elements  (tdk-* custom elements)    │  browser standards only
├──────────────────────────────────────────────────────────────┤
│ 1  Headless logic       core, datafeed, broker, storage,     │  plain TypeScript
│                         chart-engine, chart, drawings,       │
│                         indicators, layout, widgets-core     │
└──────────────────────────────────────────────────────────────┘
```

1. **Headless logic.** State, validation, calculations, the data feed and broker contracts, and the chart engine. No framework code. `core`, `datafeed`, `broker` and `widgets-core` also run without a DOM (Node, workers, tests). Their `tsconfig.json` drops the DOM library, so an accidental DOM reference fails the type check. `chart` and `chart-engine` need a DOM only to create a chart, so every package can be imported during server-side rendering.
2. **Web Components.** The default UI. Each widget is a `tdk-*` custom element with Shadow DOM, which works the same in every environment.
3. **Framework wrappers.** Thin adapters that turn element properties, events and refs into each framework's idioms. A new framework needs only a new wrapper.

You can enter at any layer. To use the default UI, take layer 2 or 3. To build your own UI, use layer 1 controllers with your own components.

## Packages and dependency direction

An arrow `A → B` means "A depends on B".

```
core           (no dependencies)
chart-engine   (no dependencies)
datafeed     → core
broker       → core
storage      → core
chart        → core, datafeed, broker, chart-engine
drawings     → chart
indicators   → chart
layout       → chart
widgets-core → core, broker, datafeed (types only)
elements     → widgets-core, lit
react        → elements   (peer: react ^18 || ^19)
vue          → elements   (peer: vue ^3.4)
all          → every package except chart-engine, react and vue
```

`chart` uses `datafeed` for timeframes and the feed contract, and `broker` for the trading overlay (order states and P&L math; the session itself is passed in). `widgets-core` takes a `MarketFeed` but only needs its type.

| Package | Responsibility |
|---|---|
| `core` | Shared trading types (bars, sides, instruments, quotes), exact decimal math for prices, quantities and money (on `BigInt`), trading sessions, the typed event emitter, observable values and other small primitives. No dependencies. |
| `datafeed` | The data feed contract, plus a mock feed and an HTTP polling adapter (WebSocket streaming follows in P2). |
| `chart-engine` | Canvas rendering engine, derived from KLineChart by liihuu (Apache-2.0) and being refactored for tickdeck. It has no tickdeck dependencies. |
| `chart` | The chart view (`createChartView`: series styles, price scale modes, history paging, realtime bars, themes) and the trading overlay (`attachTrading`: order, exit and position lines, fill markers, drag to amend, cancel and close). Panes, sessions and event markers follow. The only package that imports `chart-engine`, so the engine can change without affecting anything above `chart`. |
| `drawings` | Drawing tool registry (anchors, editing, locking, grouping, snapping) and serialization. |
| `indicators` | Built-in indicators and the custom indicator API: inputs, outputs, plot styles and a compute function. |
| `layout` | Grids of up to eight charts, and linking of instrument, timeframe, crosshair, time and visible range across them. |
| `broker` | The broker adapter contract, order and position tracking, acknowledgement deadlines and a mock broker. |
| `storage` | Persistence contract and adapters (browser storage, REST) for layouts, templates, drawings and settings. |
| `widgets-core` | One headless controller per widget: `AccountPanelController`, `OrderTicketController`, `TradeButtonsController`, `NotificationCenter`. |
| `elements` | `tdk-*` custom elements built with Lit. |
| `react`, `vue` | Framework components for the elements and, later, hooks and composables that expose controllers. |
| `all` | Re-exports every framework-agnostic package except `chart-engine` (it stays behind `chart`), registers all elements and ships the CDN bundle. |

Rules:

- Dependencies point down the layer stack only, and there are no cycles.
- Packages that render UI never leak into layer 1. `widgets-core` never imports from `elements`.
- `all` uses flat re-exports, so exported names must be unique across packages. Each package's own `VERSION` is shadowed by the one from `all`.

## Data feed contract

The integrator supplies a `MarketFeed`. tickdeck calls it and never assumes where the data comes from.

| Member | Provides |
|---|---|
| `getCapabilities()` | Timeframes, instrument kinds and venues for search filters, and whether search, depth and server time exist. tickdeck hides features the feed cannot back. |
| `findInstruments(query)`, `getInstrument(id)` | Text search, and an id resolved to an `Instrument`: name, kind, venue, currency, timezone, trading session, tick size, price precision, quantity rules (min, max, step) and point value. |
| `loadHistory(request)` | One page of bars with `from <= time < to`, oldest first. `count` asks for at least that many bars before `to`; `firstPage` marks the first request after a change. The page sets `endOfHistory` when nothing older exists, or `olderBarTime` to jump over a gap. |
| `streamBars(request, listener)` | Updates to the newest bar: an equal `time` replaces it, a later `time` starts a new bar. `onHistoryChanged` makes tickdeck drop its cache and reload. |
| `loadQuotes(ids)`, `streamQuotes({ instruments, focus }, listener)` | Last, bid, ask, sizes, day range, change and volume. `focus` instruments (order ticket, trade buttons, positions) update promptly; the rest may update about once a minute. |
| `streamDepth?(id, listener)` | Order book: a snapshot (levels best first), then deltas where `size: 0` removes a level. |
| `loadServerTime?()` | The server clock. |

Conventions:

- Requests return promises and reject with `FeedError`. Streams take a listener and return an `Unsubscribe` function, so there are no paired success and error callbacks and no subscription ids.
- Listeners are always called asynchronously, even when the feed has the data cached.
- Times are UTC epoch milliseconds. Timeframes are a count plus a case-sensitive unit: `t` ticks, `s`, `m`, `h`, then calendar units `D`, `W`, `M` (`100t`, `15s`, `5m`, `4h`, `1D`, `1W`, `1M`).
- Tick size drives price rounding and formatting. Prices, quantities and money use the decimal-exact helpers in `core`.
- The quote half of the contract (`QuoteSource`) lives in `core`, so `broker` can consume quotes without depending on `datafeed`.

`@tickdeck/datafeed` ships `MockFeed` (a seeded random walk with consistent bars at every timeframe, realtime ticks, quotes and depth, and manual quotes for tests) and `HttpPollingFeed` (a small JSON-over-HTTP API with replaceable paths and decoders, polling for realtime data). A WebSocket streaming adapter is planned for P2.

## Broker adapter contract

Trading traffic flows in two directions.

- **Requests** (tickdeck → `BrokerConnector`): connect; capabilities and connection state; list accounts, read and switch the active one; snapshots of orders, positions, fills and balance; trading rules per instrument (tradable, tick size, quantity rules, allowed order kinds and durations, point value); submit, amend and cancel orders; close (fully or partly) and reverse positions; set protective exits on a position; and optionally check an order first, which returns estimates, warnings and a confirmation token for the submit.
- **Updates** (connector → tickdeck): `connect` receives a sink, and the connector pushes `order`, `position`, `fill`, `pnl`, `balance`, `connection`, `account` (active account changed), `notice` and `resync` (full replacement) through `sink.emit`.

Principles:

- **The integrator's backend is the source of truth.** `BrokerSession` keeps a derived, in-memory view and never persists trading state.
- **Capabilities drive the UI.** The connector declares order kinds, durations (time in force), exits on orders and on positions, amendments, native close, partial close and reverse, order checks and multiple accounts. Unsupported controls are hidden. Closing is emulated with a reduce-only market order and reversing with a market order for twice the size, unless the connector turns emulation off.
- **Orders only move forward.** `pending` → `held` → `open` → `filled`, `cancelled` or `rejected`; steps may be skipped, partial fills stay `open` while the filled quantity grows, and final states never change. Updates that break this are ignored and reported as a `violation`.
- **Actions are acknowledged.** Every submit, amend, cancel, close, reverse and exit change must be followed by its confirming update within a deadline (10 seconds by default). Otherwise the session emits an `AckTimeoutError` and reloads state.
- **Protective exits follow their parent.** Take-profit (limit) and stop-loss (stop) orders attached to an entry are `held` until it fills, then protect the resulting position. When one fills, the other is cancelled.
- **Integrator data passes through.** Orders, positions and fills carry a `meta` field that tickdeck never interprets.
- **Connection state is always known.** `BrokerSession.start()` reports `connecting` as soon as it is called, then the connector's state. A failed start reports `error` with the reason and can be retried. Widgets show connecting, disconnected and error states with their reason, so they can be rendered before the session has started.

`@tickdeck/broker` includes `MockBroker`, which simulates execution against any quote stream (such as `MockFeed`): market orders at the bid or ask, limit, stop and stop-limit orders as quotes cross, protective exits with OCO, netting positions with partial close and reverse, fills, unrealized P&L, balance and equity. That lets the whole UI be developed, demoed and tested without a real broker.

## Widgets

Every widget is made of three pieces:

1. **Controller** (`widgets-core`). A plain class that holds widget state, validates input, computes derived values (cost, risk, P&L, rounding to tick size) and issues broker commands through the session. It never touches the DOM.
   - It receives a `WidgetContext { session, feed?, scheduler?, timeZone? }`: a started `BrokerSession` (every action goes through it, never to the connector), an optional feed for quotes and instrument metadata (any `MarketFeed` fits), an optional clock for timers, and the timezone for displayed times.
   - Its `state` is a read-only observable (`ReadonlyObservableValue` from `core`). State objects are replaced on every change, never mutated, so a view re-renders when `state.value` changes.
   - Action methods change state or send commands. Commands resolve once the broker confirmed them and never throw for broker problems; failures land in the state and in a typed event (`on`, `once`). `dispose()` releases subscriptions and timers.
2. **Element** (`elements`). A `tdk-*` custom element that renders a controller's state inside Shadow DOM.
   - It takes `session` and `feed` and creates (and disposes) its own controller, or renders a `controller` you pass in and keep.
   - Rich data (objects, arrays, controllers) is set as properties. Simple configuration also works as attributes.
   - User actions are dispatched as `CustomEvent`s named `tdk-<action>` that bubble and are `composed`, so they cross shadow boundaries.
   - `@tickdeck/elements` exports the element classes without registering them. `@tickdeck/elements/define` registers every element and skips tags that are already defined. Registration modules are the only files listed in `sideEffects`.
3. **Wrappers** (`react`, `vue`). Components that map props, events and refs to framework idioms. Hooks and composables will expose the controllers for fully custom UIs.

The chart is not an element yet: `createChartView(container, options)` from `chart` renders into any sized container, and `attachTrading(view, session)` draws the session's trading state on it. Applications connect the pieces with a few lines (the panel's `tdk-amend` to the ticket's `amend`, a chart price to the ticket's `usePrice`, one instrument for chart, ticket and buttons); `examples/` shows each.

| Element | Purpose | Status |
|---|---|---|
| `tdk-order-ticket` | Order entry with quantity, price, duration, protective exits, estimates, an optional review step and amend mode | P1 |
| `tdk-account-panel` | Account summary, working and past orders, positions and fills, with cancel, modify, close, reverse and exit editing | P1 |
| `tdk-trade-buttons` | Buy and sell at market with live bid, ask and spread | P1 |
| `tdk-notifications` | Toasts and a log for fills, rejections, broker notices, timeouts and connection changes | P1 |
| `tdk-chart-layout` | One or more linked charts with toolbars | Planned (P2) |
| `tdk-depth-ladder` | Order book by price level, with click-to-trade | Planned (P2) |
| `tdk-watchlist` | Instrument lists with live quotes | Planned (P2) |
| `tdk-instrument-details` | Quote, session and daily range for the active instrument | Planned (P3) |
| `tdk-news` | Headlines for the active instrument | Planned (P3) |

## Theming

- **CSS custom properties.** Every themable value is a `--tdk-*` property. Custom properties inherit into shadow roots, so you can set them on `:root` or on any container to theme one region. Values you set win over the light and dark presets.
- **Parts.** Elements expose structural nodes through `part` attributes, so you can restyle them from outside with `::part()`. Each element documents its parts in the `elements` README.
- **Presets.** Light and dark themes are token sets: `theme="light"`, `"dark"` or `"auto"` on an element, `setTheme('light' | 'dark')` on a chart view. A custom theme overrides tokens.
- **Chart.** The chart reads the same tokens from its container, when it is created and on every `setTheme` call, so the canvas matches the surrounding UI. Explicit `colors` passed to the chart win over tokens.
- Colors are flat and solid. The default themes use no gradients; the area series fill is one semi-transparent color.

| Token | Used by | Role |
|---|---|---|
| `--tdk-color-surface` | elements, chart | Backgrounds; the chart background |
| `--tdk-color-surface-2` | elements | Raised areas, neutral buttons |
| `--tdk-color-text` | elements, chart | Text |
| `--tdk-color-text-muted` | elements, chart | Labels and secondary text; chart axis labels and crosshair |
| `--tdk-color-border` | elements, chart | Borders and rules; chart axis lines |
| `--tdk-color-grid` | chart | Grid lines |
| `--tdk-color-accent` | elements, chart | Selected options, primary buttons; the line and area series |
| `--tdk-color-on-accent` | elements | Text on accent |
| `--tdk-color-buy`, `--tdk-color-sell` | elements, chart | Buy and sell buttons and sides; rising and falling bars, buy and sell orders and fills |
| `--tdk-color-on-buy`, `--tdk-color-on-sell` | elements | Text on buy and sell |
| `--tdk-color-buy-text`, `--tdk-color-sell-text` | elements | Buy, long, sell and short as text |
| `--tdk-color-positive`, `--tdk-color-negative` | elements | Gains and losses |
| `--tdk-color-info`, `--tdk-color-success`, `--tdk-color-warning`, `--tdk-color-error` | elements | Notifications, results, warnings and invalid fields |
| `--tdk-color-focus` | elements | Focus rings |
| `--tdk-color-take-profit`, `--tdk-color-stop-loss`, `--tdk-color-position` | chart | Take-profit, stop-loss and position lines |
| `--tdk-font-family` | elements, chart | All text |
| `--tdk-font-size-1`, `-2`, `-3` | elements | Small text, body text, prices and headings |
| `--tdk-space-1`, `-2`, `-3` | elements | Spacing |
| `--tdk-radius` | elements | Corner radius |
| `--tdk-control-height` | elements | Buttons and fields |
| `--tdk-z-index-toasts` | `tdk-notifications` | Stacking of the fixed toast stack |
| `--tdk-notifications-log-height` | `tdk-notifications` | Height of the log list |

The light and dark defaults of each token are listed in the `elements` and `chart` READMEs.

```css
:root {
  --tdk-color-surface: #ffffff;
  --tdk-color-text: #1b1f24;
  --tdk-color-buy: #1a7f5a;
  --tdk-color-sell: #c4314b;
  --tdk-color-position: #6d28d9;
}

tdk-order-ticket::part(submit-button) {
  font-weight: 600;
}
```

## Build and distribution

- **Output.** Each package builds with tsup from a shared base config (`tsup.base.ts`) to ES modules plus `.d.ts` files, targeting ES2022. Consumers need Node 20 or later, or an evergreen browser.
- **Package shape.** Each package has an `exports` map with `types` and `import` conditions, `"type": "module"`, and `files` limited to `dist`, `LICENSE` and `NOTICE`. The build copies `LICENSE` and `NOTICE` from the repository root into each package. `chart-engine` keeps its upstream `LICENSE` and takes only the root `NOTICE`.
- **Side effects.** Every package sets `sideEffects: false` except the registration modules: `@tickdeck/elements/define`, and `@tickdeck/all` (its entry and its CDN bundle).
- **Peer dependencies.** React and Vue are peer dependencies of their wrappers, so the application's copy is used.
- **CDN bundle.** `@tickdeck/all/dist/tickdeck.js` is a single minified ES module with every dependency inlined. Load it with `<script type="module">` and use the elements directly. The package exports it as `@tickdeck/all/cdn` (and under its file path), typed like the main entry, and exports `./package.json`.
- **Custom Elements Manifest.** Planned: `@tickdeck/elements` will ship a generated `custom-elements.json`, which feeds editor completions, wrapper generation and API docs.
- **Versioning.** Changesets manages versions and generates changelogs. All `@tickdeck/*` packages are one fixed group and always share a version. Prereleases come from Changesets pre mode (`0.1.0-alpha.N`, pre tag `alpha`). Until a package has had a stable release, Changesets publishes its prereleases so that `latest` points at the newest one; after that they go out on the `alpha` dist-tag and stable releases on `latest`.
- **Internal dependencies.** Packages depend on each other with `workspace:*`. Publishing with pnpm (`changeset publish` in this workspace, or `pnpm publish -r`) turns that into the exact version being released; publishing a package directory with plain `npm publish` would not.
- **Registry.** Packages are published publicly to npm under the `@tickdeck` scope. Publishing is not automated yet. CI builds, type-checks and tests every push and pull request to `main`, and builds the examples.
- **Examples.** `examples/` holds private Vite apps (vanilla, React, Vue) that are part of the workspace but never published. `pnpm build` builds packages only; `pnpm build:examples` builds the examples.
- **Toolchain.** Node 24, pnpm via Corepack, TypeScript 5.9, tsup, Vitest.

## Roadmap

| Phase | Status | Scope | Done when |
|---|---|---|---|
| **P1: Trading MVP** | Done | `core`; mock and HTTP polling feeds; a single chart (candles, bars, line, area) with price scale modes; the broker contract and mock broker; account panel; order ticket (market, limit and stop, with take-profit and stop-loss); trade buttons; order and position lines on the chart; notifications | An order placed against the mock broker goes through fill, position and protective exit, and every step shows up on the chart and in the panels |
| **P2: Charting depth** | Next | WebSocket feed adapter; up to eight linked charts; watchlist; depth ladder; 40+ indicators; 40+ drawing tools; save and restore; theming | A saved layout restores identically, and the depth ladder stays smooth at dozens of updates per second |
| **P3: Completeness** | Planned | 100+ indicators; the full drawing tool set; Renko, Kagi, point-and-figure, line break, Heikin-Ashi and volume-weighted candles; instrument details, cursor data and news panels; i18n; accessibility; touch and mobile; keyboard shortcuts | At least 90% of the planned feature list is covered |
| **P4: Optional** | Planned | Volume profile; crypto-style order entry; leverage; position netting; multiple exit levels | Built when there is demand |

## Licensing

tickdeck is licensed under the Apache License 2.0. Attributions live in the root `NOTICE`, and every published package ships both `LICENSE` and `NOTICE`. `@tickdeck/chart-engine` is derived from KLineChart by liihuu (Apache-2.0), and its upstream notices are retained.
