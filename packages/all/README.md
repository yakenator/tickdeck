# @tickdeck/all

Every framework-agnostic tickdeck package in one import, except the raw rendering engine, which stays behind `@tickdeck/chart`. Importing it registers all `tdk-*` elements. Also ships `dist/tickdeck.js`, a self-contained ES module for use straight from a CDN.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/all
```

```js
import { BrokerSession, MockBroker, MockFeed, attachTrading, createChartView } from '@tickdeck/all';
```

The package re-exports `core`, `datafeed`, `broker`, `chart`, `widgets-core`, `elements`, `drawings`, `indicators`, `layout` and `storage`. Importing it always includes the elements, since it registers them; bundlers drop the other exports you do not use.

## CDN, no build step

`dist/tickdeck.js` is one minified ES module with every dependency inlined (about 390 kB minified, 115 kB gzipped). A chart, an order ticket and an account panel on mock data:

```html
<div id="chart" style="height: 420px"></div>
<tdk-order-ticket instrument="MOCK:ACME" kind="limit"></tdk-order-ticket>
<tdk-account-panel></tdk-account-panel>
<tdk-notifications placement="bottom-end"></tdk-notifications>

<script type="module">
  import { BrokerSession, MockBroker, MockFeed, attachTrading, createChartView } from 'https://cdn.jsdelivr.net/npm/@tickdeck/all@0.1.0-alpha.0/dist/tickdeck.js';

  const feed = new MockFeed();
  const session = new BrokerSession(new MockBroker({ feed }));
  await session.start();

  // Orders, exits and positions on the chart: drag to amend, × to cancel or close.
  attachTrading(createChartView(document.getElementById('chart'), { feed, instrument: 'MOCK:ACME', timeframe: '1m' }), session);

  for (const element of document.querySelectorAll('tdk-order-ticket, tdk-account-panel, tdk-notifications')) {
    element.session = session;
    element.feed = feed;
  }

  // "Modify" in the account panel opens the order in the ticket.
  const ticket = document.querySelector('tdk-order-ticket');
  document.querySelector('tdk-account-panel').addEventListener('tdk-amend', (event) => ticket.amend(event.detail.order));
</script>
```

Pin an exact version in production. Replace `MockFeed` and `MockBroker` with your own `MarketFeed` and `BrokerConnector` (see `@tickdeck/datafeed` and `@tickdeck/broker`).

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
