# Storybook

Every published tickdeck element and the chart, rendered in known states with Storybook 10 (`@storybook/web-components-vite`). Like the apps, it installs `@tickdeck/*` from npm at the version in [`../tickdeck.version`](../tickdeck.version), so it shows exactly what a release ships.

Hosted with the playground at <https://yakenator.github.io/tickdeck/storybook/>.

## Browse and run

From `playground/`:

```sh
npm run storybook          # dev server at http://localhost:6006
npm run test:storybook     # every story as a test in headless Chromium
npm run build-storybook    # static build in storybook/dist (npm run build includes it)
```

The **Theme** button in the toolbar switches every story between light and dark. Controls map to element attributes and properties, and to the chart's options.

| Section | Stories |
|---|---|
| Widgets / Order ticket | Market, limit, stop, stop-limit; take-profit and stop-loss as prices and as ticks; validation (price off the tick size, quantity off the step, take-profit on the wrong side); the check and review step; amend mode; busy while the broker has not answered; an acknowledgement timeout; no connection; connecting; could not connect; dark theme; instrument picker; keyboard use |
| Widgets / Account panel | Empty; connecting to the broker; could not connect; working orders with held exits; all orders; positions with exits and P&L; fills; the partial-close row; a confirmed partial close; no connection; sorting; cancel from the panel; keyboard tabs; order times in UTC, Seoul and New York; dark theme |
| Widgets / Trade buttons | Normal; one-click buy; confirm mode armed and confirmed; disabled while connecting, after a failed start, while disconnected, not tradable, with an invalid quantity and without an instrument; dark theme |
| Widgets / Notifications | Info, success, warning and error; stacked toasts; the log; Escape to dismiss; toasts from the session for a fill, a rejection, a missing acknowledgement, a lost connection and a failed start; log times in UTC, Seoul and New York; fixed to a corner |
| Chart / Chart view | Candles, bars, line and area; log, percent and indexed scales; dark theme; volume in its own pane (default), overlaid, hidden, in the dark theme and switched with `setVolume`; the trading overlay with a position, its exits and a working order; a working order with held exits; exits far outside the bars kept in view by autoscale, and marked at the pane's edges with `autoscaleTradingLines: false` |
| Composite / Trading screen | The chart and all four widgets on one session in the equal-height layout, checked as loaded, with TP/SL enabled, for a market order (and the chart shrinking back when the exits are removed) and with a chart taller than the column; a limit order with TP/SL cancelled from the panel; fill, position and take-profit with notifications; Modify opening the order in the ticket |

## Deterministic states

[`src/scenario.ts`](src/scenario.ts) builds a `MockFeed` (seed 7, `autoTick: false`), a `MockBroker` and a `BrokerSession` on a fixed clock (2026-01-15 14:30 UTC), so bars, prices and order times never change. A story picks its state with `parameters.scenario`, and a loader creates it before the story renders:

```ts
export const AmendMode: Story = {
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement, loaded }) => {
    const ticket = canvasElement.querySelector('tdk-order-ticket')!;
    await ticket.amend(loaded.scenario.session.orders[0]!);
  },
};
```

| `state` | What the session holds |
|---|---|
| `empty` (default) | Connected, nothing traded |
| `connecting` | The connector reports `connecting` and never finishes |
| `failed` | Connecting fails after 400 ms with "Broker gateway unreachable (mock)": `session.start()` rejects |
| `working` | A limit buy of 10 with take-profit and stop-loss (held), and a limit sell of 5 |
| `orders` | One working limit order on each mock instrument |
| `position` | A long position of 10 with exits and unrealized P&L, and a working limit sell |
| `far-exits` | A long position of 10 with its take-profit and stop-loss 8.00 above and below the price, far outside the 1m bars |
| `history` | A position bought and closed at a profit, a cancelled order and the fills |
| `disconnected` | Connected once, then the connection dropped |
| `rejected` | An order the broker rejected (price off the tick size) |

`holdOrderUpdates: true` keeps the broker's order updates from reaching the session, so a submit is never acknowledged: with a long `ackTimeoutMs` the ticket stays busy, with a short one the session reports a timeout. `rules` overrides trading rules per instrument, for example `{ 'MOCK:ACME': { tradable: false, reason: 'Trading halted' } }`. Each scenario is disposed when its story unmounts.

The account panel and the notifications get the same fixed clock (`scheduler`) and the time zone of their `time-zone` control (UTC by default), so their times read the same on every run.

The chart stories use [`<playground-chart>`](src/chart-host.ts), a small element that calls `createChartView` (with `volume`) and `attachTrading` (with `autoscaleTradingLines`) when it is attached and disposes the view when it is removed. It fills the box its layout gives it: a fixed height on its own, the stretched grid cell with a `min-height` in the trading screen. It is temporary; 0.1.0-alpha.3 brings a `<tdk-chart>` element.

## Layout: equal height

The trading screen uses the pattern from the `@tickdeck/chart` and `@tickdeck/elements` READMEs ([`src/tokens.css`](src/tokens.css)): one grid row with `align-items: stretch`, a `min-height` (not a fixed `height`) on the chart cell, and the side column as a flex column in which the ticket has `flex: 1`. Its stories measure that the chart cell, the chart drawn in it, the side column and the ticket's visible box (`::part(form)`) all end at the same pixel (±1) and log the numbers: as loaded, with take-profit and stop-loss enabled (the column grows and the chart with it), for a market order (and again after removing the exits, when the chart shrinks back), and with a chart `min-height` taller than the column (the ticket's box stretches). The tests run in a 1400 × 1000 window, like the browser tests.

## Tests

`@storybook/addon-vitest` turns every story into a Vitest browser test (Chromium through `@vitest/browser-playwright`): the story renders, its `play` function runs (clicks, typing and keys inside the elements' shadow roots, with assertions from `storybook/test`), and then axe checks the result. `parameters.a11y.test` is `'error'`, so any accessibility violation fails the story.

Nothing is excluded from the accessibility checks. 0.1.0-alpha.1 needed five node-scoped exclusions; 0.1.0-alpha.2 fixed all of them, so they were removed and every rule now guards against a regression:

| Component | Rule | Issue in 0.1.0-alpha.1 | Fixed in 0.1.0-alpha.2 |
|---|---|---|---|
| `tdk-order-ticket` | `label-content-name-mismatch` (WCAG 2.5.3) | Bid and Ask buttons named "Bid 111.22", visible text "Bid111.22" | The visible text reads "Bid 111.22" |
| `tdk-trade-buttons` | `label-content-name-mismatch` (WCAG 2.5.3) | Sell and Buy named "Sell 10 ACME at market, bid 111.22" | Named by the visible text ("Sell 111.22"), the order in `aria-describedby` |
| `tdk-trade-buttons` | `aria-prohibited-attr` (WCAG 4.1.2) | The spread was a `<div>` with `aria-label` and hidden text | Plain text |
| `tdk-account-panel` | `label-content-name-mismatch` (WCAG 2.5.3) | "TP/SL" named "Edit take-profit and stop-loss: Long 10 ACME" | The name starts with "TP/SL" |
| `@tickdeck/chart` | `tabindex` | The engine's root had `tabindex="1"` | `tabindex="0"`, role `img`, named "ACME, 1m chart" |

A violation in a later release fails its story; report it rather than excluding it.

## With each release

`scripts/update.mjs` moves Storybook to the new version along with the apps, `npm run build` builds it, `npm run verify` runs its tests (the **Storybook** column in [`../RESULTS.md`](../RESULTS.md)), and `npm run site` publishes it at `storybook/` next to the apps.
