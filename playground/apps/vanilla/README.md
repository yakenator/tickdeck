# Web Components with a bundler

The full trading screen with the `tdk-*` custom elements and the chart, installed from npm and bundled with Vite. No framework.

```sh
npm install @tickdeck/elements@0.1.0-alpha.2 @tickdeck/chart@0.1.0-alpha.2 @tickdeck/broker@0.1.0-alpha.2 @tickdeck/datafeed@0.1.0-alpha.2
# used here for exact price math and error messages:
npm install @tickdeck/core@0.1.0-alpha.2 @tickdeck/widgets-core@0.1.0-alpha.2
```

```html
<div id="chart"></div>
<tdk-trade-buttons id="buttons" quantity="10"></tdk-trade-buttons>
<tdk-order-ticket id="ticket" kind="limit" quantity="10"></tdk-order-ticket>
<tdk-account-panel id="panel"></tdk-account-panel>
<tdk-notifications id="notifications" placement="bottom-end"></tdk-notifications>
```

```ts
import '@tickdeck/elements/define';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { attachTrading, createChartView } from '@tickdeck/chart';
import { MockFeed } from '@tickdeck/datafeed';

const feed = new MockFeed({ seed: 7 });
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

for (const widget of [buttons, ticket, panel, notifications]) {
  widget.session = session;
  widget.feed = feed;
}
const view = createChartView(chart, { feed, instrument: 'MOCK:ACME', timeframe: '1m', volume: 'pane' });
attachTrading(view, session);

// "Modify" in the account panel opens the order in the ticket.
panel.addEventListener('tdk-amend', ({ detail: { order } }) => ticket.amend(order));
```

[`src/style.css`](src/style.css) lays the chart and the side column out with the equal-height pattern (a stretched grid row, a `min-height` on the chart cell, the ticket with `flex: 1` in a flex column), so both end at the same line. [`src/main.ts`](src/main.ts) adds the rest of the recipes from `examples/README.md`: volume in its own pane, as an overlay or hidden, switching the instrument everywhere, Alt-click a chart price into the ticket, a take-profit and stop-loss dialog for positions ([`src/exits-dialog.ts`](src/exits-dialog.ts)), errors from chart gestures, theme switching and a simulated market control.

```sh
npm run dev --workspace apps/vanilla     # from playground/
```
