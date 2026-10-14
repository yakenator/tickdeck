# React

`@tickdeck/react` renders each element as a React 18 or 19 component. Rich props (`session`, `feed`, `controller`) become element properties, callback props such as `onAmend` subscribe to the element's events, and `ref` reaches the element itself. This app uses React 19 and Vite.

```sh
npm install @tickdeck/react@0.1.0-alpha.2 @tickdeck/chart@0.1.0-alpha.2 @tickdeck/broker@0.1.0-alpha.2 @tickdeck/datafeed@0.1.0-alpha.2 react react-dom
```

```tsx
import { BrokerSession, MockBroker } from '@tickdeck/broker';
import { attachTrading, createChartView } from '@tickdeck/chart';
import { MockFeed } from '@tickdeck/datafeed';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons, type TdkOrderTicketElement } from '@tickdeck/react';
import { useEffect, useRef } from 'react';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

export function Trading() {
  const chart = useRef<HTMLDivElement>(null);
  const ticket = useRef<TdkOrderTicketElement>(null);

  // The chart is not an element: create it in an effect and dispose it on unmount.
  useEffect(() => {
    const view = createChartView(chart.current!, { feed, instrument: 'MOCK:ACME', timeframe: '1m', volume: 'pane' });
    attachTrading(view, session);
    return () => view.dispose();
  }, []);

  return (
    <>
      <div className="trading">
        <div ref={chart} className="chart" />
        <div className="side">
          <TdkTradeButtons session={session} feed={feed} instrument="MOCK:ACME" quantity={10} />
          <TdkOrderTicket ref={ticket} session={session} feed={feed} instrument="MOCK:ACME" kind="limit" />
        </div>
      </div>
      <TdkAccountPanel session={session} feed={feed} onAmend={(event) => ticket.current?.amend(event.detail.order)} />
      <TdkNotifications session={session} feed={feed} placement="bottom-end" />
    </>
  );
}
```

The element and event types (`TdkOrderTicketElement`, `TdkAmendDetail`, ...) come from `@tickdeck/react`, which re-exports them since 0.1.0-alpha.2, so the app does not depend on `@tickdeck/elements` itself. The chart and the side column use the equal-height layout ([`src/style.css`](src/style.css)): a grid row with `align-items: stretch`, `min-height` on `.chart` instead of a fixed height, and `.side` as a flex column with the ticket at `flex: 1`.

[`src/App.tsx`](src/App.tsx) and [`src/TradingChart.tsx`](src/TradingChart.tsx) add a volume selector (pane, overlay, none), instrument sync, Alt-click a chart price into the ticket, a take-profit and stop-loss form, theme switching and a simulated market control.

```sh
npm run dev --workspace apps/react     # from playground/
```
