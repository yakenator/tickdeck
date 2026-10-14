# tickdeck

Framework-agnostic building blocks for trading interfaces: charts, order entry, account and position panels, depth ladders and watchlists. Use them as standard Web Components in plain HTML, through thin React and Vue wrappers, or as headless logic behind your own UI.

> **Status: pre-alpha, under construction.** Nothing is published yet and every API will change. The examples below show the intended usage.

tickdeck does not ship market data or brokerage access. Your application plugs in a **data feed** (instruments, bars, quotes, order book depth) and a **broker adapter** (accounts, orders, positions). tickdeck renders what they provide and turns user actions into commands for them.

## Design

tickdeck is split into three layers. Each layer builds only on the ones below it.

| Layer | Packages | Depends on |
|---|---|---|
| 1. Headless logic | `core`, `datafeed`, `chart-engine`, `chart`, `drawings`, `indicators`, `layout`, `broker`, `storage`, `widgets-core` | Plain TypeScript, no framework |
| 2. Web Components | `elements` | Browser standards only (Custom Elements, Shadow DOM) |
| 3. Framework wrappers | `react`, `vue` | One framework each |

- Layer 2 works on its own anywhere HTML renders, with or without a framework.
- Supporting another framework means adding a small layer 3 wrapper. Layers 1 and 2 stay untouched.
- Need a completely different look? Skip layer 2 and drive your own components from the layer 1 controllers.
- The default UI is themed with `--tdk-*` CSS custom properties and `::part()` selectors.

Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Packages

| Package | Layer | Purpose |
|---|---|---|
| `@tickdeck/core` | 1 | Shared types and a typed event emitter |
| `@tickdeck/datafeed` | 1 | Data feed contract, mock and HTTP polling feeds (WebSocket adapter in P2) |
| `@tickdeck/chart-engine` | 1 | Rendering engine, derived from KLineChart by liihuu (Apache-2.0); being refactored for tickdeck |
| `@tickdeck/chart` | 1 | Chart model, series styles and price scales; the only package that talks to `chart-engine` |
| `@tickdeck/drawings` | 1 | Drawing tool registry, anchors and persistence |
| `@tickdeck/indicators` | 1 | Built-in indicators and a custom indicator API |
| `@tickdeck/layout` | 1 | Up to eight charts with linked instrument, timeframe, crosshair and range |
| `@tickdeck/broker` | 1 | Broker adapter contract, order tracking and a mock broker |
| `@tickdeck/storage` | 1 | Persistence for layouts, templates, drawings and settings |
| `@tickdeck/widgets-core` | 1 | Headless controllers behind every widget |
| `@tickdeck/elements` | 2 | `tdk-*` custom elements |
| `@tickdeck/react` | 3 | React 18 and 19 components |
| `@tickdeck/vue` | 3 | Vue 3 components |
| `@tickdeck/all` | 1 + 2 | Everything except the framework wrappers and the raw engine, plus a CDN bundle |

## Install

Install the layer you need:

```sh
# Web Components, with any framework or none
npm install @tickdeck/elements

# React
npm install @tickdeck/react

# Vue
npm install @tickdeck/vue

# Headless logic only
npm install @tickdeck/widgets-core @tickdeck/datafeed @tickdeck/broker
```

`pnpm add` and `yarn add` work the same way.

### Web Components

```js
import '@tickdeck/elements/define';
```

```html
<tdk-placeholder label="Hello"></tdk-placeholder>
```

### React

```tsx
import { TdkPlaceholder } from '@tickdeck/react';

export function App() {
  return <TdkPlaceholder label="Hello" />;
}
```

### Vue

```vue
<script setup lang="ts">
import { TdkPlaceholder } from '@tickdeck/vue';
</script>

<template>
  <TdkPlaceholder label="Hello" />
</template>
```

### CDN, no build step

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@tickdeck/all/dist/tickdeck.js"></script>

<tdk-placeholder label="Hello"></tdk-placeholder>
```

Pin an exact version (`@tickdeck/all@x.y.z`) in production.

`tdk-placeholder` is a stand-in that exercises the build and packaging. Real widgets arrive with the roadmap below.

## Roadmap

| Phase | Scope | Done when |
|---|---|---|
| **P1: Trading MVP** | Core types; mock and HTTP polling feeds; a single chart (candles, bars, line, area) with price scale modes; broker contract with a mock broker; account panel; order ticket (market, limit and stop, with take-profit and stop-loss); buy and sell buttons; order and position lines on the chart; notifications | An order placed against the mock broker goes through fill, position and protective exit, and every step shows up on the chart and in the panels |
| **P2: Charting depth** | WebSocket feed adapter; up to eight linked charts; watchlist; depth ladder; 40+ indicators; 40+ drawing tools; save and restore; theming | A saved layout restores identically, and the depth ladder stays smooth at dozens of updates per second |
| **P3: Completeness** | 100+ indicators; the full drawing tool set; Renko, Kagi, point-and-figure, line break, Heikin-Ashi and volume-weighted candles; instrument details, cursor data and news panels; i18n; accessibility; touch and mobile; keyboard shortcuts | At least 90% of the planned feature list is covered |
| **P4: Optional** | Volume profile; crypto-style order entry; leverage; position netting; multiple exit levels | Built when there is demand |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attributions. `@tickdeck/chart-engine` is derived from KLineChart by liihuu, also licensed under Apache-2.0.
