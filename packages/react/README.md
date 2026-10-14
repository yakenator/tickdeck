# @tickdeck/react

React components for the tickdeck widgets. They render the `tdk-*` custom elements from `@tickdeck/elements`, set rich props (session, feed, controller, arrays) as element properties and subscribe callback props to the elements' events through a ref, so they behave the same on React 18 and 19.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/react @tickdeck/broker @tickdeck/datafeed
```

`react` (18 or 19) is a peer dependency. Importing `@tickdeck/react` registers the elements.

## Usage

```tsx
import { useEffect, useRef, useState } from 'react';
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons, type TdkOrderTicketElement } from '@tickdeck/react';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
const started = session.start();

export function Trading() {
  const ticket = useRef<TdkOrderTicketElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => void started.then(() => setReady(true)), []);
  if (!ready) return null;

  return (
    <>
      <TdkOrderTicket
        ref={ticket}
        session={session}
        feed={feed}
        instrument="MOCK:ACME"
        kind="limit"
        onOrderPlaced={(event) => console.log('placed', event.detail.orderId)}
      />
      <TdkTradeButtons session={session} feed={feed} instrument="MOCK:ACME" quantity={1} theme="dark" />
      <TdkAccountPanel session={session} feed={feed} onAmend={(event) => ticket.current?.amend(event.detail.order)} />
      <TdkNotifications session={session} feed={feed} placement="bottom-end" />
    </>
  );
}
```

Callbacks receive the element's `CustomEvent`; the payload is `event.detail`. For the cancelable events (`onCancelOrder`, `onClosePosition`, `onReversePosition`), `event.preventDefault()` stops the action. A `ref` gives the element itself, for example `amend(order)` or `usePrice(price)` on the ticket.

Other props (`id`, `className`, `style`, `aria-*`, `children`) go to the element.

## Components

All components accept `session`, `feed`, `controller` and `theme` (see the [`@tickdeck/elements` README](https://github.com/yakenator/tickdeck/tree/main/packages/elements#readme)).

| Component | Element | Props | Callbacks |
|---|---|---|---|
| `TdkOrderTicket` | `tdk-order-ticket` | `instrument`, `side`, `kind`, `quantity`, `checkOrders`, `exitMode`, `instruments` | `onOrderPlaced`, `onOrderAmended`, `onOrderError` |
| `TdkAccountPanel` | `tdk-account-panel` | `tab`, `orderFilter` | `onCancelOrder`, `onAmend`, `onClosePosition`, `onReversePosition`, `onEditExits`, `onActionError`, `onTabChange` |
| `TdkTradeButtons` | `tdk-trade-buttons` | `instrument`, `quantity`, `confirm` | `onOrderPlaced`, `onOrderError` |
| `TdkNotifications` | `tdk-notifications` | `placement`, `hideLog`, `maxToasts` | `onNotification`, `onDismiss` |

`@tickdeck/react` also exports the element types for refs (`TdkOrderTicketElement` and the others) and the event detail types (`TdkOrderPlacedDetail` and the others), so you never import from `@tickdeck/elements` directly; it is installed as a dependency of `@tickdeck/react`. Theming (`--tdk-*` custom properties and `::part()`) is described in the [`@tickdeck/elements` README](https://github.com/yakenator/tickdeck/tree/main/packages/elements#readme).

To render a controller you manage yourself (for example to share one between components or to drive it from code), create it with `@tickdeck/widgets-core` and pass it as `controller`.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
