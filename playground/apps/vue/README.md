# Vue

`@tickdeck/vue` renders each element as a Vue 3 component: props are bound as element properties, the element's events are emits (`@amend`, `@edit-exits`), and the component instance exposes the element as `element`. This app uses Vue 3.5 and Vite.

```sh
npm install @tickdeck/vue@0.1.0-alpha.2 @tickdeck/chart@0.1.0-alpha.2 @tickdeck/broker@0.1.0-alpha.2 @tickdeck/datafeed@0.1.0-alpha.2 vue
```

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { attachTrading, createChartView, type ChartView } from '@tickdeck/chart';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons } from '@tickdeck/vue';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
void session.start();

const chart = ref<HTMLDivElement>();
const ticket = ref<InstanceType<typeof TdkOrderTicket>>();
// A plain variable, not a ref: Vue proxies cannot reach the view's private state.
let view: ChartView | undefined;
onMounted(() => {
  view = createChartView(chart.value!, { feed, instrument: 'MOCK:ACME', timeframe: '1m', volume: 'pane' });
  attachTrading(view, session);
});
onBeforeUnmount(() => view?.dispose());
</script>

<template>
  <div class="trading">
    <div ref="chart" class="chart"></div>
    <div class="side">
      <TdkTradeButtons :session="session" :feed="feed" instrument="MOCK:ACME" :quantity="10" />
      <TdkOrderTicket ref="ticket" :session="session" :feed="feed" instrument="MOCK:ACME" kind="limit" />
    </div>
  </div>
  <TdkAccountPanel :session="session" :feed="feed" @amend="({ order }) => ticket?.element?.amend(order)" />
  <TdkNotifications :session="session" :feed="feed" placement="bottom-end" />
</template>
```

The event detail and element types (`TdkAmendDetail`, `TdkOrderTicketElement`, ...) come from `@tickdeck/vue`, which re-exports them since 0.1.0-alpha.2, so the app does not depend on `@tickdeck/elements` itself. The chart and the side column use the equal-height layout ([`src/style.css`](src/style.css)): a grid row with `align-items: stretch`, `min-height` on `.chart` instead of a fixed height, and `.side` as a flex column with the ticket at `flex: 1`.

[`src/App.vue`](src/App.vue) and [`src/TradingChart.vue`](src/TradingChart.vue) add a volume selector (pane, overlay, none), instrument sync, Alt-click a chart price into the ticket, a take-profit and stop-loss form, theme switching and a simulated market control.

```sh
npm run dev --workspace apps/vue     # from playground/
```
