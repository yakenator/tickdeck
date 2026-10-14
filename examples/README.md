# tickdeck examples

Three small Vite apps that run a trading screen on `MockFeed` and `MockBroker`, with one `BrokerSession` shared by every part. They are workspace packages, private and never published. They import the built packages, so the root scripts build first:

```sh
pnpm install
pnpm dev:vanilla   # or dev:react, dev:vue
```

`pnpm build:examples` type-checks and builds all three (CI runs it after `pnpm build`).

| Example | What it shows |
|---|---|
| [`vanilla`](vanilla) | The full screen with plain Web Components: chart with trading overlay, trade buttons, order ticket, account panel and notifications; instrument, timeframe, style, scale and theme switchers; a simulated market control; a dialog for position take-profit and stop-loss |
| [`react`](react) | The same composition with `@tickdeck/react`; the chart is created in an effect |
| [`vue`](vue) | The same composition with `@tickdeck/vue`; the chart is created in `onMounted` |

## Integrations an application wires itself

The widgets never talk to each other directly. These are the few lines an app adds, as the examples do.

### One session and one feed for everything

```ts
const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

for (const widget of document.querySelectorAll('tdk-trade-buttons, tdk-order-ticket, tdk-account-panel, tdk-notifications')) {
  widget.session = session;
  widget.feed = feed;
}
const view = createChartView(container, { feed, instrument: 'MOCK:ACME', timeframe: '1m' });
const trading = attachTrading(view, session);
```

### Switching the instrument everywhere

The chart, the ticket and the trade buttons each take the instrument; set all three together.

```ts
async function selectInstrument(id: string) {
  ticket.instrument = id;
  buttons.instrument = id;
  await view.setInstrument(id);
}
```

### "Modify" in the account panel opens the order in the ticket

```ts
panel.addEventListener('tdk-amend', async ({ detail: { order } }) => {
  await selectInstrument(order.instrument); // the order may be on another instrument
  await ticket.amend(order);
});
```

The ticket keeps amend mode when its `instrument` is set to the order's instrument around the `amend` call, so the order of the two calls does not matter (React and Vue re-render after the handler).

### "TP/SL" in the account panel

`tdk-edit-exits` carries the position. Collect the new levels in any form and send them through the panel's controller, which marks the row as busy and reports failures in the panel:

```ts
panel.addEventListener('tdk-edit-exits', ({ detail: { position } }) => openExitsDialog(position));

// On save: a price sets an exit, null removes it, undefined keeps it.
const ok = await panel.activeController.setPositionExits(position.id, { takeProfit: 101.5, stopLoss: null });
```

`examples/vanilla/src/exits-dialog.ts` is a small `<dialog>` that also checks the tick size and that each exit is on the right side of the market.

### Picking a price on the chart

`view.crosshair` holds the price under the pointer, rounded to the tick. The examples use Alt-click (Option-click on macOS), so plain clicks and drags keep panning the chart and moving lines, and ignore clicks that ended a drag:

```ts
let pressedAt = { x: 0, y: 0 };
container.addEventListener('pointerdown', (e) => (pressedAt = { x: e.clientX, y: e.clientY }), true);
container.addEventListener('click', (e) => {
  const moved = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4;
  const price = view.crosshair.value?.price;
  if (e.altKey && !moved && price !== undefined) ticket.usePrice(price);
});
```

`ticket.usePrice(price)` fills the limit price, or the stop price of a stop or stop-limit order. The vanilla example also turns a market ticket into a limit order (price on the passive side of the market) or a stop order (the other side) first.

### Errors from chart gestures

Rejections and acknowledgement timeouts already reach `tdk-notifications` through the session. Anything else a drag or × ran into arrives as the overlay's `actionError`:

```ts
trading.on('actionError', ({ error }) => {
  if (!(error instanceof AckTimeoutError)) {
    notifications.activeController?.push({ level: 'error', title: 'The change from the chart failed', message: describeTradingError(error) });
  }
});
```

### Theme

The examples set one flat token set per theme on `:root` (`--tdk-color-surface`, `-surface-2`, `-text`, `-text-muted`, `-border`, `-grid`, `-accent`), so the page, the chart and the widgets match. Switching the theme sets `data-theme` on `<html>` first, then `theme` on the widgets and `view.setTheme(theme)`, which reads the tokens again.

### Simulated market

`MockFeed` follows a seeded random walk. The vanilla example's "Simulated market" field calls `feed.setQuote(id, { bid, ask, last })` with one tick each side of the typed price, so you can walk the market through a limit price, a take-profit or a stop-loss; the random walk continues from there.
