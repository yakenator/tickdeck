# Headless in Node

tickdeck's logic layer runs without a DOM. Two scripts, run by `npm run test:node` from `playground/`:

## [`strategy.mjs`](strategy.mjs): a bracket order on the broker session

```sh
npm install @tickdeck/broker@0.1.0-alpha.2 @tickdeck/datafeed@0.1.0-alpha.2 @tickdeck/core@0.1.0-alpha.2
```

```js
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';

const feed = new MockFeed({ seed: 42, autoTick: false }); // prices move only on setQuote
const session = new BrokerSession(new MockBroker({ feed, startingBalance: 100_000 }));
session.on('fill', (fill) => console.log('fill', fill.side, fill.quantity, fill.price));
await session.start();

await feed.setQuote('MOCK:ACME', { bid: 99.99, ask: 100.01, last: 100 });
await session.submitOrder({ instrument: 'MOCK:ACME', side: 'buy', kind: 'limit', quantity: 10, limitPrice: 99.5, takeProfit: 101, stopLoss: 99 });
await feed.setQuote('MOCK:ACME', { bid: 99.47, ask: 99.49, last: 99.48 });   // the entry fills
await feed.setQuote('MOCK:ACME', { bid: 101.01, ask: 101.03, last: 101.02 }); // the take-profit fills, the stop-loss is cancelled
```

It checks every step (entry working with held exits, fill, position with unrealized P&L, take-profit fill with the stop-loss cancelled, realized P&L and balance) and prints a summary:

```text
tickdeck 0.1.0-alpha.1: headless bracket order on MOCK:ACME
  orders     entry=filled, take-profit=filled, stop-loss=cancelled
  fills      buy 10 @ 99.50, sell 10 @ 101.00
  unrealized 7.40 while open
  realized   15.00
  balance    100015.00 USD, equity 100015.00
```

## [`ssr.mjs`](ssr.mjs): imports and server-side rendering

- `@tickdeck/chart`, `@tickdeck/elements` (and `/define`) and `@tickdeck/all` import in Node without a DOM.
- `@tickdeck/all/cdn` and `@tickdeck/all/dist/tickdeck.js` resolve to the CDN bundle, and `@tickdeck/all/package.json` imports as JSON. The CDN bundle itself is a browser module (it defines the elements on the DOM's `HTMLElement`), so it is only resolved here.
- `renderToString` from `react-dom/server` renders the `@tickdeck/react` wrappers, and `renderToString` from `vue/server-renderer` renders the `@tickdeck/vue` wrappers, with no objects leaking into attributes.

Since 0.1.0-alpha.2 the wrappers render simple props (strings, numbers, booleans) as the element's attributes, `true` as an empty attribute and `false` not at all; rich props such as `session` and `feed` are set as properties once the page hydrates. The checks assert the exact attributes:

```html
<main><tdk-trade-buttons instrument="MOCK:ACME" quantity="10"></tdk-trade-buttons><tdk-order-ticket class="ticket" instrument="MOCK:ACME" kind="limit" check-orders=""></tdk-order-ticket><tdk-account-panel time-zone="Asia/Seoul"></tdk-account-panel></main>
```
