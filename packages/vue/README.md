# @tickdeck/vue

Vue 3 components for the tickdeck widgets. They render the `tdk-*` custom elements from `@tickdeck/elements`, bind rich props as element properties and re-emit the elements' events with their detail as typed emits.

> Pre-alpha and under construction. APIs will change without notice.

## Install

```sh
npm install @tickdeck/vue @tickdeck/broker @tickdeck/datafeed
```

`vue` (3.4 or later) is a peer dependency. Importing `@tickdeck/vue` registers the elements.

## Usage

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import type { TdkAmendDetail } from '@tickdeck/elements';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons } from '@tickdeck/vue';

const feed = new MockFeed();
const session = shallowRef(new BrokerSession(new MockBroker({ feed })));
const ready = ref(false);
session.value.start().then(() => (ready.value = true));

const ticket = ref<InstanceType<typeof TdkOrderTicket>>();
const amend = ({ order }: TdkAmendDetail) => ticket.value?.element?.amend(order);
</script>

<template>
  <template v-if="ready">
    <TdkOrderTicket ref="ticket" :session="session" :feed="feed" instrument="MOCK:ACME" kind="limit"
      @order-placed="({ orderId }) => console.log('placed', orderId)" />
    <TdkTradeButtons :session="session" :feed="feed" instrument="MOCK:ACME" :quantity="1" theme="dark" />
    <TdkAccountPanel :session="session" :feed="feed" @amend="amend" />
    <TdkNotifications :session="session" :feed="feed" placement="bottom-end" />
  </template>
</template>
```

Keep sessions, feeds and controllers out of deep reactivity (`shallowRef` or `markRaw`): they hold private state that Vue proxies cannot reach. The components unwrap proxies before handing objects to the elements, so a `reactive()` object still works, but raw objects avoid needless proxying.

Emits carry the event detail. The cancelable account panel events (`cancel-order`, `close-position`, `reverse-position`) also pass the `CustomEvent` as a second argument; call `preventDefault()` on it to stop the action. Each component exposes `element`, the custom element once mounted (for example `element.amend(order)` or `element.usePrice(price)` on the ticket). It is typed on the instance, so `ref<InstanceType<typeof TdkOrderTicket>>()` sees it.

## Components

All components accept `session`, `feed`, `controller` and `theme` (see `@tickdeck/elements`).

| Component | Props | Emits |
|---|---|---|
| `TdkOrderTicket` | `instrument`, `side`, `kind`, `quantity`, `checkOrders`, `exitMode`, `instruments` | `order-placed`, `order-amended`, `order-error` |
| `TdkAccountPanel` | `tab`, `orderFilter` | `cancel-order`, `amend`, `close-position`, `reverse-position`, `edit-exits`, `action-error`, `tab-change` |
| `TdkTradeButtons` | `instrument`, `quantity`, `confirm` | `order-placed`, `order-error` |
| `TdkNotifications` | `placement`, `hideLog`, `maxToasts` | `notification`, `dismiss` |

Detail types (`TdkOrderPlacedDetail` and the others) are exported by `@tickdeck/elements`. Theming (`--tdk-*` custom properties and `::part()`) is described there as well.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
