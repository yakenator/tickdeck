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
| Widgets / Order ticket | Market, limit, stop, stop-limit; take-profit and stop-loss as prices and as ticks; validation (price off the tick size, quantity off the step, take-profit on the wrong side); the check and review step; amend mode; busy while the broker has not answered; an acknowledgement timeout; no connection; dark theme; instrument picker; keyboard use |
| Widgets / Account panel | Empty; loading; working orders with held exits; all orders; positions with exits and P&L; fills; the partial-close row; a confirmed partial close; no connection; sorting; cancel from the panel; keyboard tabs; dark theme |
| Widgets / Trade buttons | Normal; one-click buy; confirm mode armed and confirmed; disabled while disconnected, not tradable, with an invalid quantity and without an instrument; dark theme |
| Widgets / Notifications | Info, success, warning and error; stacked toasts; the log; Escape to dismiss; toasts from the session for a fill, a rejection, a missing acknowledgement and a lost connection; fixed to a corner |
| Chart / Chart view | Candles, bars, line and area; log, percent and indexed scales; dark theme; the trading overlay with a position, its exits and a working order; a working order with held exits |
| Composite / Trading screen | The chart and all four widgets on one session; a limit order with TP/SL cancelled from the panel; fill, position and take-profit with notifications; Modify opening the order in the ticket |

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
| `working` | A limit buy of 10 with take-profit and stop-loss (held), and a limit sell of 5 |
| `orders` | One working limit order on each mock instrument |
| `position` | A long position of 10 with exits and unrealized P&L, and a working limit sell |
| `history` | A position bought and closed at a profit, a cancelled order and the fills |
| `disconnected` | Connected once, then the connection dropped |
| `rejected` | An order the broker rejected (price off the tick size) |

`holdOrderUpdates: true` keeps the broker's order updates from reaching the session, so a submit is never acknowledged: with a long `ackTimeoutMs` the ticket stays busy, with a short one the session reports a timeout. `rules` overrides trading rules per instrument, for example `{ 'MOCK:ACME': { tradable: false, reason: 'Trading halted' } }`. Each scenario is disposed when its story unmounts.

The chart stories use [`<playground-chart>`](src/chart-host.ts), a small element that calls `createChartView` and `attachTrading` when it is attached and disposes the view when it is removed.

## Tests

`@storybook/addon-vitest` turns every story into a Vitest browser test (Chromium through `@vitest/browser-playwright`): the story renders, its `play` function runs (clicks, typing and keys inside the elements' shadow roots, with assertions from `storybook/test`), and then axe checks the result. `parameters.a11y.test` is `'error'`, so any accessibility violation fails the story.

Known accessibility issues in the published 0.1.0-alpha.1 components are listed in [`.storybook/preview.ts`](.storybook/preview.ts). Each one is excluded only for the affected nodes, so the rule keeps running everywhere else, and each is reported for a fix in the library:

| Component | Rule | Issue |
|---|---|---|
| `tdk-order-ticket` | `label-content-name-mismatch` (WCAG 2.5.3) | Bid and Ask buttons are named "Bid 111.22" while their visible text reads "Bid111.22" |
| `tdk-trade-buttons` | `label-content-name-mismatch` (WCAG 2.5.3) | Sell and Buy are named "Sell 10 ACME at market, bid 111.22"; the visible "Sell 111.22" is not part of the name |
| `tdk-trade-buttons` | `aria-prohibited-attr` (WCAG 4.1.2) | The spread is a `<div>` with `aria-label` and no role, and its text is `aria-hidden`, so screen readers get no spread at all |
| `tdk-account-panel` | `label-content-name-mismatch` (WCAG 2.5.3) | The "TP/SL" button is named "Edit take-profit and stop-loss: Long 10 ACME" |
| `@tickdeck/chart` | `tabindex` | The chart engine's root `<div>` has `tabindex="1"` |

When a release fixes one, remove its exclusion; the test then guards against a regression.

## With each release

`scripts/update.mjs` moves Storybook to the new version along with the apps, `npm run build` builds it, `npm run verify` runs its tests (the **Storybook** column in [`../RESULTS.md`](../RESULTS.md)), and `npm run site` publishes it at `storybook/` next to the apps.
