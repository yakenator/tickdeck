# Vue

`@tickdeck/vue` renders each element as a Vue 3 component: props are bound as element properties, the element's events are emits (`@amend`, `@edit-exits`), and the component instance exposes the element as `element`. This app uses Vue 3.5 and Vite.

```sh
npm install @tickdeck/vue@0.1.0-alpha.1 @tickdeck/elements@0.1.0-alpha.1 @tickdeck/chart@0.1.0-alpha.1 @tickdeck/broker@0.1.0-alpha.1 @tickdeck/datafeed@0.1.0-alpha.1 vue
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
  view = createChartView(chart.value!, { feed, instrument: 'MOCK:ACME', timeframe: '1m' });
  attachTrading(view, session);
});
onBeforeUnmount(() => view?.dispose());
</script>

<template>
  <div ref="chart" style="height: 460px"></div>
  <TdkTradeButtons :session="session" :feed="feed" instrument="MOCK:ACME" :quantity="10" />
  <TdkOrderTicket ref="ticket" :session="session" :feed="feed" instrument="MOCK:ACME" kind="limit" />
  <TdkAccountPanel :session="session" :feed="feed" @amend="({ order }) => ticket?.element?.amend(order)" />
  <TdkNotifications :session="session" :feed="feed" placement="bottom-end" />
</template>
```

[`src/App.vue`](src/App.vue) and [`src/TradingChart.vue`](src/TradingChart.vue) add instrument sync, Alt-click a chart price into the ticket, a take-profit and stop-loss form, theme switching and a simulated market control.

```sh
npm run dev --workspace apps/vue     # from playground/
```
