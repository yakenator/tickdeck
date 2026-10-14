# tickdeck

Framework-agnostic building blocks for trading interfaces: charts, order entry, account and position panels, depth ladders and watchlists. Use them as standard Web Components in plain HTML, through thin React and Vue wrappers, or as headless logic behind your own UI.

> **Status: alpha.** The P1 trading MVP is complete: a chart with order and position lines, an order ticket, trade buttons, an account panel and notifications, on any data feed and broker adapter. Releases are prereleases (`0.1.0-alpha.N`), and APIs may still change before 1.0.

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
| `@tickdeck/core` | 1 | Trading types, exact decimal math for prices and quantities, sessions, events and observable values |
| `@tickdeck/datafeed` | 1 | Data feed contract, mock and HTTP polling feeds (WebSocket adapter in P2) |
| `@tickdeck/broker` | 1 | Broker adapter contract, order lifecycle, acknowledgement deadlines, `BrokerSession` and a mock broker |
| `@tickdeck/chart-engine` | 1 | Rendering engine, derived from KLineChart by liihuu (Apache-2.0); being refactored for tickdeck |
| `@tickdeck/chart` | 1 | Chart view (styles, price scales, history paging, realtime bars) and the trading overlay; the only package that talks to `chart-engine` |
| `@tickdeck/widgets-core` | 1 | Headless controllers: account panel, order ticket, trade buttons, notifications |
| `@tickdeck/elements` | 2 | `tdk-*` custom elements |
| `@tickdeck/react` | 3 | React 18 and 19 components |
| `@tickdeck/vue` | 3 | Vue 3 components |
| `@tickdeck/all` | 1 + 2 | Everything except the framework wrappers and the raw engine, plus a CDN bundle |
| `@tickdeck/drawings` | 1 | Drawing tools (P2; type sketches only so far) |
| `@tickdeck/indicators` | 1 | Indicators and a custom indicator API (P2; type sketches only so far) |
| `@tickdeck/layout` | 1 | Up to eight linked charts (P2; type sketches only so far) |
| `@tickdeck/storage` | 1 | Persistence for layouts, templates, drawings and settings (P2; type sketches only so far) |

## Install

Install the layer you need:

```sh
# Web Components and the chart, with any framework or none
npm install @tickdeck/elements @tickdeck/chart @tickdeck/broker @tickdeck/datafeed

# React
npm install @tickdeck/react @tickdeck/chart @tickdeck/broker @tickdeck/datafeed

# Vue
npm install @tickdeck/vue @tickdeck/chart @tickdeck/broker @tickdeck/datafeed

# Headless logic only
npm install @tickdeck/widgets-core @tickdeck/broker @tickdeck/datafeed
```

`pnpm add` and `yarn add` work the same way. All `@tickdeck/*` packages share one version; install matching versions.

## Usage

Every part works on one `BrokerSession` (your `BrokerConnector`, or `MockBroker` for development) and one `MarketFeed` (yours, `HttpPollingFeed`, or `MockFeed`). The examples below run entirely on mock data.

### Web Components

```html
<div id="chart" style="height: 420px"></div>
<tdk-order-ticket instrument="MOCK:ACME" kind="limit"></tdk-order-ticket>
<tdk-trade-buttons instrument="MOCK:ACME" quantity="1"></tdk-trade-buttons>
<tdk-account-panel></tdk-account-panel>
<tdk-notifications placement="bottom-end"></tdk-notifications>
```

```js
import '@tickdeck/elements/define';
import { attachTrading, createChartView } from '@tickdeck/chart';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

// Orders, exits and positions on the chart: drag to amend, × to cancel or close.
const view = createChartView(document.getElementById('chart'), { feed, instrument: 'MOCK:ACME', timeframe: '1m' });
attachTrading(view, session);

for (const element of document.querySelectorAll('tdk-order-ticket, tdk-trade-buttons, tdk-account-panel, tdk-notifications')) {
  element.session = session;
  element.feed = feed;
}

// "Modify" in the account panel opens the order in the ticket.
const ticket = document.querySelector('tdk-order-ticket');
document.querySelector('tdk-account-panel').addEventListener('tdk-amend', (event) => ticket.amend(event.detail.order));
```

### React

```tsx
import { useEffect, useRef } from 'react';
import { attachTrading, createChartView } from '@tickdeck/chart';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, type TdkOrderTicketElement } from '@tickdeck/react';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

export function Trading() {
  const chart = useRef<HTMLDivElement>(null);
  const ticket = useRef<TdkOrderTicketElement>(null);

  useEffect(() => {
    const view = createChartView(chart.current!, { feed, instrument: 'MOCK:ACME', timeframe: '1m' });
    attachTrading(view, session);
    return () => view.dispose();
  }, []);

  return (
    <>
      <div ref={chart} style={{ height: 420 }} />
      <TdkOrderTicket ref={ticket} session={session} feed={feed} instrument="MOCK:ACME" kind="limit" />
      <TdkAccountPanel session={session} feed={feed} onAmend={(event) => ticket.current?.amend(event.detail.order)} />
      <TdkNotifications session={session} feed={feed} placement="bottom-end" />
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { attachTrading, createChartView, type ChartView } from '@tickdeck/chart';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket } from '@tickdeck/vue';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
void session.start(); // the widgets and the chart's lines catch up once it has connected

const chart = ref<HTMLDivElement>();
const ticket = ref<InstanceType<typeof TdkOrderTicket>>();
let view: ChartView | undefined;
onMounted(() => {
  view = createChartView(chart.value!, { feed, instrument: 'MOCK:ACME', timeframe: '1m' });
  attachTrading(view, session);
});
onBeforeUnmount(() => view?.dispose());
</script>

<template>
  <div ref="chart" style="height: 420px"></div>
  <TdkOrderTicket ref="ticket" :session="session" :feed="feed" instrument="MOCK:ACME" kind="limit" />
  <TdkAccountPanel :session="session" :feed="feed" @amend="({ order }) => ticket?.element?.amend(order)" />
  <TdkNotifications :session="session" :feed="feed" placement="bottom-end" />
</template>
```

### CDN, no build step

`@tickdeck/all/dist/tickdeck.js` is one ES module with everything inlined except the framework wrappers. It registers the elements and exports every API.

```html
<div id="chart" style="height: 420px"></div>
<tdk-order-ticket instrument="MOCK:ACME" kind="limit"></tdk-order-ticket>
<tdk-account-panel></tdk-account-panel>

<script type="module">
  import { BrokerSession, MockBroker, MockFeed, attachTrading, createChartView } from 'https://cdn.jsdelivr.net/npm/@tickdeck/all@0.1.0-alpha.0/dist/tickdeck.js';

  const feed = new MockFeed();
  const session = new BrokerSession(new MockBroker({ feed }));
  await session.start();

  attachTrading(createChartView(document.getElementById('chart'), { feed, instrument: 'MOCK:ACME', timeframe: '1m' }), session);
  for (const element of document.querySelectorAll('tdk-order-ticket, tdk-account-panel')) {
    element.session = session;
    element.feed = feed;
  }
</script>
```

Pin an exact version in production.

## Examples

[`examples/`](examples) has three runnable apps on mock data: a full trading screen with plain Web Components, and the same composition with React and with Vue. They show the integrations an application wires itself: instrument switching, amending from the account panel, editing a position's take-profit and stop-loss, picking a price on the chart, and theming.

```sh
pnpm install
pnpm dev:vanilla   # or dev:react, dev:vue
```

## Playground

[`playground/`](playground) holds consumer apps that install the published packages from npm at one pinned version, the way your project would: a CDN page with no build step, Web Components with Vite, React, Vue, headless Node with server-side rendering, and TypeScript checks under `bundler`, `nodenext` and `node16` resolution. A Storybook shows every element and the chart in deterministic states, and runs each story as an interaction and accessibility test. Each release is verified there end to end (install, build, type check, Node tests, Storybook tests and a browser run of the trading flow), and the results are recorded in [`playground/RESULTS.md`](playground/RESULTS.md). The built apps and Storybook are published at <https://yakenator.github.io/tickdeck/>.

```sh
cd playground
npm ci
npx playwright install chromium
npm run verify
```

## Roadmap

| Phase | Status | Scope | Done when |
|---|---|---|---|
| **P1: Trading MVP** | Done | Core types; mock and HTTP polling feeds; a single chart (candles, bars, line, area) with price scale modes; broker contract with a mock broker; account panel; order ticket (market, limit and stop, with take-profit and stop-loss); buy and sell buttons; order and position lines on the chart; notifications | An order placed against the mock broker goes through fill, position and protective exit, and every step shows up on the chart and in the panels |
| **P2: Charting depth** | Next | WebSocket feed adapter; up to eight linked charts; watchlist; depth ladder; 40+ indicators; 40+ drawing tools; save and restore; theming | A saved layout restores identically, and the depth ladder stays smooth at dozens of updates per second |
| **P3: Completeness** | Planned | 100+ indicators; the full drawing tool set; Renko, Kagi, point-and-figure, line break, Heikin-Ashi and volume-weighted candles; instrument details, cursor data and news panels; i18n; accessibility; touch and mobile; keyboard shortcuts | At least 90% of the planned feature list is covered |
| **P4: Optional** | Planned | Volume profile; crypto-style order entry; leverage; position netting; multiple exit levels | Built when there is demand |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attributions. `@tickdeck/chart-engine` is derived from KLineChart by liihuu, also licensed under Apache-2.0.
