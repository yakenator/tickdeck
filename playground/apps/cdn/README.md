# CDN, no build step

[`index.html`](index.html) is a complete trading page that loads tickdeck from jsDelivr: no `npm install`, no bundler. Open it from any static web server (`npm run preview` in `playground/` serves it at `/tickdeck/cdn/`).

`@tickdeck/all/dist/tickdeck.js` is one ES module with everything inlined except the React and Vue wrappers. Loading it registers the `tdk-*` elements; importing from the same URL gives you every API.

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@tickdeck/all@0.1.0-alpha.2/dist/tickdeck.js"></script>

<div class="trading">
  <div id="chart"></div>
  <div class="side">
    <tdk-trade-buttons instrument="MOCK:ACME" quantity="10"></tdk-trade-buttons>
    <tdk-order-ticket instrument="MOCK:ACME" kind="limit"></tdk-order-ticket>
  </div>
</div>
<tdk-account-panel></tdk-account-panel>
<tdk-notifications placement="bottom-end"></tdk-notifications>

<script type="module">
  import { BrokerSession, MockBroker, MockFeed, attachTrading, createChartView } from 'https://cdn.jsdelivr.net/npm/@tickdeck/all@0.1.0-alpha.2/dist/tickdeck.js';

  const feed = new MockFeed();
  const session = new BrokerSession(new MockBroker({ feed }));
  await session.start();

  attachTrading(createChartView(document.getElementById('chart'), { feed, instrument: 'MOCK:ACME', timeframe: '1m', volume: 'pane' }), session);
  for (const element of document.querySelectorAll('tdk-trade-buttons, tdk-order-ticket, tdk-account-panel, tdk-notifications')) {
    element.session = session;
    element.feed = feed;
  }
</script>
```

The page lays the chart and the side column out with the equal-height pattern from the `@tickdeck/chart` README, so both end at the same line whichever is taller:

```css
.trading { display: grid; grid-template-columns: minmax(0, 1fr) 320px; align-items: stretch; gap: 8px; }
#chart { min-height: 440px; min-width: 0; } /* a minimum, not a fixed height */
.side { display: flex; flex-direction: column; gap: 8px; }
.side tdk-order-ticket { flex: 1; }
```

Volume shows in its own pane below the prices (`volume: 'pane'`, the default since 0.1.0-alpha.2).

Pin an exact version in the URL. `scripts/update.mjs` rewrites it in this page when the playground moves to a new release.
