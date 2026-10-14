# CDN, no build step

[`index.html`](index.html) is a complete trading page that loads tickdeck from jsDelivr: no `npm install`, no bundler. Open it from any static web server (`npm run preview` in `playground/` serves it at `/tickdeck/cdn/`).

`@tickdeck/all/dist/tickdeck.js` is one ES module with everything inlined except the React and Vue wrappers. Loading it registers the `tdk-*` elements; importing from the same URL gives you every API.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@tickdeck/all@0.1.0-alpha.2/dist/tickdeck.js"></script>

<div id="chart" style="height: 440px"></div>
<tdk-trade-buttons instrument="MOCK:ACME" quantity="10"></tdk-trade-buttons>
<tdk-order-ticket instrument="MOCK:ACME" kind="limit"></tdk-order-ticket>
<tdk-account-panel></tdk-account-panel>
<tdk-notifications placement="bottom-end"></tdk-notifications>

<script type="module">
  import { BrokerSession, MockBroker, MockFeed, attachTrading, createChartView } from 'https://cdn.jsdelivr.net/npm/@tickdeck/all@0.1.0-alpha.2/dist/tickdeck.js';

  const feed = new MockFeed();
  const session = new BrokerSession(new MockBroker({ feed }));
  await session.start();

  attachTrading(createChartView(document.getElementById('chart'), { feed, instrument: 'MOCK:ACME', timeframe: '1m' }), session);
  for (const element of document.querySelectorAll('tdk-trade-buttons, tdk-order-ticket, tdk-account-panel, tdk-notifications')) {
    element.session = session;
    element.feed = feed;
  }
</script>
```

Pin an exact version in the URL. `scripts/update.mjs` rewrites it in this page when the playground moves to a new release.
