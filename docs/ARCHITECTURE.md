# tickdeck architecture

> Pre-alpha. This document describes the target design. Most of it is not implemented yet, and names may change.

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

1. **Headless logic.** State, validation, calculations, the data feed and broker contracts, and the chart engine. No framework code. `core`, `datafeed`, `broker` and `widgets-core` also run without a DOM (Node, workers, tests). Their `tsconfig.json` drops the DOM library, so an accidental DOM reference fails the type check.
2. **Web Components.** The default UI. Each widget is a `tdk-*` custom element with Shadow DOM, which works the same in every environment.
3. **Framework wrappers.** Thin adapters that turn element properties, events and refs into each framework's idioms. A new framework needs only a new wrapper.

You can enter at any layer. To use the default UI, take layer 2 or 3. To build your own UI, use layer 1 controllers with your own components.

## Packages and dependency direction

An arrow `A → B` means "A depends on B".

```
core           (no dependencies)
chart-engine   (no tickdeck dependencies)
datafeed     → core
broker       → core
storage      → core
chart        → core, chart-engine
drawings     → chart
indicators   → chart
layout       → chart
widgets-core → core, broker, datafeed
elements     → widgets-core, lit
react        → elements   (peer: react ^18 || ^19)
vue          → elements   (peer: vue ^3.4)
all          → every package except chart-engine, react and vue
```

| Package | Responsibility |
|---|---|
| `core` | Shared types (bars, sides, instruments), the typed event emitter, observable values and other small primitives. No dependencies. |
| `datafeed` | The data feed contract, plus reference adapters for HTTP polling and WebSocket streaming. |
| `chart-engine` | Canvas rendering engine, derived from KLineChart by liihuu (Apache-2.0) and being refactored for tickdeck. It has no tickdeck dependencies. |
| `chart` | Chart model, series styles, price scale modes, panes, sessions and event markers. The only package that imports `chart-engine`, so the engine can change without affecting anything above `chart`. |
| `drawings` | Drawing tool registry (anchors, editing, locking, grouping, snapping) and serialization. |
| `indicators` | Built-in indicators and the custom indicator API: inputs, outputs, plot styles and a compute function. |
| `layout` | Grids of up to eight charts, and linking of instrument, timeframe, crosshair, time and visible range across them. |
| `broker` | The broker adapter contract, order and position tracking, acknowledgement deadlines and a mock broker. |
| `storage` | Persistence contract and adapters (browser storage, REST) for layouts, templates, drawings and settings. |
| `widgets-core` | One headless controller per widget. |
| `elements` | `tdk-*` custom elements built with Lit. |
| `react`, `vue` | Framework components and, later, hooks and composables that expose controllers. |
| `all` | Re-exports every framework-agnostic package except `chart-engine` (it stays behind `chart`), registers all elements and ships the CDN bundle. |

Rules:

- Dependencies point down the layer stack only, and there are no cycles.
- Packages that render UI never leak into layer 1. `widgets-core` never imports from `elements`.
- `all` uses flat re-exports, so exported names must be unique across packages. Each package's own `VERSION` is shadowed by the one from `all`.

## Data feed contract

The integrator supplies a feed object. tickdeck calls it and never assumes where the data comes from.

What a feed provides:

- **Capabilities.** Which timeframes, instrument kinds and venues exist, and whether quotes, depth, server time and event markers are available. tickdeck hides features the feed cannot back.
- **Instrument lookup.** Text search, and resolving an instrument id to metadata: display name, venue, kind, timezone, trading sessions, tick size, quantity step and currency.
- **History.** Bars for an instrument and timeframe within a time window. tickdeck asks for older pages as the user scrolls back, and the feed says when there is nothing older.
- **Live bars.** A stream of updates to the newest bar. Equal timestamps update the bar in place, and a later timestamp starts a new bar. The feed can also report that past data changed, which makes tickdeck reload.
- **Quotes.** Last price, bid, ask, change and volume for a set of instruments. The watchlist, order ticket, trade buttons and P&L figures rely on them.
- **Depth.** Order book snapshots followed by incremental changes, used by the depth ladder.

Conventions:

- Requests return promises. Streams take a callback and return an `Unsubscribe` function, so there are no paired success and error callbacks and no subscription ids.
- Results are always treated as asynchronous, even when the feed has them cached.
- Times are UTC epoch milliseconds. Timeframes are compact strings such as `1s`, `1m`, `15m`, `1h`, `1D`, `1W` and `1M`.
- Tick size drives price rounding and formatting. Money values use decimal-safe arithmetic.
- `@tickdeck/datafeed` ships two reference adapters, one for HTTP polling against a small JSON API and one for WebSocket streaming. Integrators can use them or implement the contract directly.

## Broker adapter contract

Trading traffic flows in two directions.

- **Commands** (tickdeck → adapter): connect; list accounts and pick the active one; fetch snapshots of orders, positions, fills and balances; submit, amend and cancel orders; close or reverse positions; set or change protective exits (take-profit and stop-loss); and optionally preview an order (costs, margin, warnings) before it is sent.
- **Updates** (adapter → tickdeck): on connect, the adapter receives an update sink. It pushes order, position and fill changes, balance, equity and margin figures, P&L and connection state through it. When the adapter loses track of state, it can push a full resync.

Principles:

- **The integrator's backend is the source of truth.** tickdeck keeps a derived, in-memory view and never persists trading state.
- **Capabilities drive the UI.** The adapter declares what it supports, such as order kinds, durations (time in force), protective exits, partial close, reversal, preview and multiple accounts. Unsupported controls are hidden. Where it is safe, a missing operation is emulated with plain orders (for example, closing through an offsetting market order), and the adapter can turn emulation off.
- **Orders only move forward.** An order goes from `pending` to `open`, or to `held` for a child order waiting for its parent to fill. It ends in `filled`, `cancelled` or `rejected`. Partial fills stay `open` while the filled quantity grows.
- **Commands are acknowledged.** Every command must be confirmed by a matching update within a configurable deadline. If not, tickdeck reports a timeout and requests a resync.
- **Protective exits follow their parent.** Take-profit and stop-loss orders attached to an entry order are `held` until it fills. They then protect the resulting position, and when one exit fills the other is cancelled.
- **Integrator data passes through.** Orders and positions carry a `meta` field that tickdeck never interprets.

`@tickdeck/broker` includes an in-memory **mock broker**. It fills market orders immediately and fills limit and stop orders from the quote stream. That lets the whole UI be developed, demoed and tested without a real broker.

## Widgets

Every widget is made of three pieces:

1. **Controller** (`widgets-core`). A plain class that holds widget state, validates input, computes derived values (cost, risk, P&L, rounding to tick size), issues broker commands and emits `change` events. It receives a `WidgetContext` with the feed, broker and settings, and has no DOM access.
2. **Element** (`elements`). A `tdk-*` custom element that renders a controller's state inside Shadow DOM.
   - Rich data (objects, arrays, controllers) is set as properties. Simple configuration also works as attributes.
   - User actions are dispatched as `CustomEvent`s named `tdk-<action>` that bubble and are `composed`, so they cross shadow boundaries.
   - `@tickdeck/elements` exports the element classes without registering them. `@tickdeck/elements/define` registers every element and skips tags that are already defined. Registration modules are the only files listed in `sideEffects`.
3. **Wrappers** (`react`, `vue`). Components that map props, events and refs to framework idioms. Hooks and composables will expose the controllers for fully custom UIs.

Planned elements:

| Element | Purpose |
|---|---|
| `tdk-chart-layout` | One or more linked charts with toolbars |
| `tdk-order-ticket` | Order entry with quantity, price, duration and protective exits |
| `tdk-account-panel` | Orders, positions, history, notifications and account summary |
| `tdk-depth-ladder` | Order book by price level, with click-to-trade |
| `tdk-watchlist` | Instrument lists with live quotes |
| `tdk-trade-buttons` | Buy and sell buttons showing bid and ask |
| `tdk-instrument-details` | Quote, session and daily range for the active instrument |
| `tdk-news` | Headlines for the active instrument |

## Theming

- **CSS custom properties.** Every themable value is a `--tdk-*` property. Custom properties inherit into shadow roots, so you can set them on `:root` or on any container to theme one region.
- **Token names.** `--tdk-color-<role>` (for example `surface`, `text`, `border`, `accent`, `buy`, `sell`), `--tdk-space-<n>`, `--tdk-radius`, `--tdk-font-family` and `--tdk-font-size-<n>`.
- **Parts.** Elements expose structural nodes through `part` attributes, so you can restyle them from outside with `::part()`. Each element documents its parts.
- **Presets.** Light and dark themes are just token sets, and a custom theme overrides tokens. The chart reads the same tokens, so the canvas matches the surrounding UI.
- Colors are flat and solid. The default themes use no gradients.

```css
:root {
  --tdk-color-surface: #ffffff;
  --tdk-color-text: #1b1f24;
  --tdk-color-buy: #1a7f5a;
  --tdk-color-sell: #c4314b;
}

tdk-placeholder::part(label) {
  font-weight: 600;
}
```

## Build and distribution

- **Output.** Each package builds with tsup from a shared base config (`tsup.base.ts`) to ES modules plus `.d.ts` files, targeting ES2022. Consumers need Node 20 or later, or an evergreen browser.
- **Package shape.** Each package has an `exports` map with `types` and `import` conditions, `"type": "module"`, and `files` limited to `dist`, `LICENSE` and `NOTICE`. The build copies `LICENSE` and `NOTICE` from the repository root into each package. `chart-engine` keeps its upstream `LICENSE` and takes only the root `NOTICE`.
- **Side effects.** Every package sets `sideEffects: false` except the registration modules: `@tickdeck/elements/define`, and `@tickdeck/all` (its entry and its CDN bundle).
- **Peer dependencies.** React and Vue are peer dependencies of their wrappers, so the application's copy is used.
- **CDN bundle.** `@tickdeck/all/dist/tickdeck.js` is a single minified ES module with every dependency inlined. Load it with `<script type="module">` and use the elements directly.
- **Custom Elements Manifest.** Planned: `@tickdeck/elements` will ship a generated `custom-elements.json`, which feeds editor completions, wrapper generation and API docs.
- **Versioning.** Changesets manages per-package semver and generates changelogs. Prereleases go out on the `next` dist-tag, and stable releases on `latest`.
- **Registry.** Packages are published publicly to npm under the `@tickdeck` scope. Publishing is not automated yet. CI builds, type-checks and tests every push and pull request to `main`.
- **Toolchain.** Node 24, pnpm via Corepack, TypeScript 5.9, tsup, Vitest.

## Roadmap

| Phase | Scope | Done when |
|---|---|---|
| **P1: Trading MVP** | `core`; HTTP and WebSocket feeds; a single chart (candles, bars, line, area) with price scale modes; the broker contract and mock broker; account panel; order ticket (market, limit and stop, with take-profit and stop-loss); trade buttons; order and position lines on the chart; notifications | An order placed against the mock broker goes through fill, position and protective exit, and every step shows up on the chart and in the panels |
| **P2: Charting depth** | Up to eight linked charts; watchlist; depth ladder; 40+ indicators; 40+ drawing tools; save and restore; theming | A saved layout restores identically, and the depth ladder stays smooth at dozens of updates per second |
| **P3: Completeness** | 100+ indicators; the full drawing tool set; Renko, Kagi, point-and-figure, line break, Heikin-Ashi and volume-weighted candles; instrument details, cursor data and news panels; i18n; accessibility; touch and mobile; keyboard shortcuts | At least 90% of the planned feature list is covered |
| **P4: Optional** | Volume profile; crypto-style order entry; leverage; position netting; multiple exit levels | Built when there is demand |

## Licensing

tickdeck is licensed under the Apache License 2.0. Attributions live in the root `NOTICE`, and every published package ships both `LICENSE` and `NOTICE`. `@tickdeck/chart-engine` is derived from KLineChart by liihuu (Apache-2.0), and its upstream notices are retained.
