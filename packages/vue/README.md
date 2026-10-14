# @tickdeck/vue

Vue 3 components for the tickdeck widgets. They render the `tdk-*` custom elements from `@tickdeck/elements`, bind rich props as element properties and re-emit the elements' events with their detail as typed emits.

> Alpha: APIs may still change between releases.

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
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons, type TdkAmendDetail } from '@tickdeck/vue';

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

Simple props (strings, numbers, booleans such as `instrument`, `kind`, `quantity`, `checkOrders`, `theme`, `timeZone`) are bound both as properties and as the element's attributes (`check-orders`, `time-zone`, ...), so server-side rendering produces meaningful HTML such as `<tdk-order-ticket instrument="MOCK:ACME" kind="limit">`; `true` becomes an empty attribute and `false` none. Rich props (`session`, `feed`, `controller`, `scheduler`, arrays) are set as properties in the browser. Other attributes (`class`, `id`, `style`, `aria-*`) and native listeners go to the element.

Emits carry the event detail. The cancelable account panel events (`cancel-order`, `close-position`, `reverse-position`) also pass the `CustomEvent` as a second argument; call `preventDefault()` on it to stop the action. Each component exposes `element`, the custom element once mounted (for example `element.amend(order)` or `element.usePrice(price)` on the ticket). It is typed on the instance, so `ref<InstanceType<typeof TdkOrderTicket>>()` sees it.

## Components

All components accept `session`, `feed`, `controller`, `scheduler`, `timeZone` and `theme` (see the [`@tickdeck/elements` README](https://github.com/yakenator/tickdeck/tree/main/packages/elements#readme)).

| Component | Props | Emits |
|---|---|---|
| `TdkOrderTicket` | `instrument`, `side`, `kind`, `quantity`, `checkOrders`, `exitMode`, `instruments` | `order-placed`, `order-amended`, `order-error` |
| `TdkAccountPanel` | `tab`, `orderFilter` | `cancel-order`, `amend`, `close-position`, `reverse-position`, `edit-exits`, `action-error`, `tab-change` |
| `TdkTradeButtons` | `instrument`, `quantity`, `confirm` | `order-placed`, `order-error` |
| `TdkNotifications` | `placement`, `hideLog`, `maxToasts` | `notification`, `dismiss` |

`@tickdeck/vue` also exports the detail types (`TdkOrderPlacedDetail` and the others) and the element types (`TdkOrderTicketElement` and the others), so you never import from `@tickdeck/elements` directly; it is installed as a dependency of `@tickdeck/vue`. Theming (`--tdk-*` custom properties and `::part()`) is described in the [`@tickdeck/elements` README](https://github.com/yakenator/tickdeck/tree/main/packages/elements#readme).

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
