# React

`@tickdeck/react` renders each element as a React 18 or 19 component. Rich props (`session`, `feed`, `controller`) become element properties, callback props such as `onAmend` subscribe to the element's events, and `ref` reaches the element itself. This app uses React 19 and Vite.

```sh
npm install @tickdeck/react@0.1.0-alpha.2 @tickdeck/elements@0.1.0-alpha.2 @tickdeck/chart@0.1.0-alpha.2 @tickdeck/broker@0.1.0-alpha.2 @tickdeck/datafeed@0.1.0-alpha.2 react react-dom
```

```tsx
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { attachTrading, createChartView } from '@tickdeck/chart';
import { MockFeed } from '@tickdeck/datafeed';
import type { TdkOrderTicketElement } from '@tickdeck/elements';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons } from '@tickdeck/react';
import { useEffect, useRef } from 'react';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

export function Trading() {
  const chart = useRef<HTMLDivElement>(null);
  const ticket = useRef<TdkOrderTicketElement>(null);

  // The chart is not an element: create it in an effect and dispose it on unmount.
  useEffect(() => {
    const view = createChartView(chart.current!, { feed, instrument: 'MOCK:ACME', timeframe: '1m' });
    attachTrading(view, session);
    return () => view.dispose();
  }, []);

  return (
    <>
      <div ref={chart} style={{ height: 460 }} />
      <TdkTradeButtons session={session} feed={feed} instrument="MOCK:ACME" quantity={10} />
      <TdkOrderTicket ref={ticket} session={session} feed={feed} instrument="MOCK:ACME" kind="limit" />
      <TdkAccountPanel session={session} feed={feed} onAmend={(event) => ticket.current?.amend(event.detail.order)} />
      <TdkNotifications session={session} feed={feed} placement="bottom-end" />
    </>
  );
}
```

[`src/App.tsx`](src/App.tsx) and [`src/TradingChart.tsx`](src/TradingChart.tsx) add instrument sync, Alt-click a chart price into the ticket, a take-profit and stop-loss form, theme switching and a simulated market control.

```sh
npm run dev --workspace apps/react     # from playground/
```
