# @tickdeck/chart-engine

## 0.1.0-alpha.2

### Patch Changes

- b82b8b3: Accessibility (WCAG 2.5.3 Label in Name, 4.1.2): the order ticket's Bid and Ask buttons read "Bid 111.22" on screen as in their names; the trade buttons are named by their visible text ("Sell 111.22") and describe the order and any reason they are disabled through `aria-describedby`; the spread between them is plain text instead of an `aria-label` on a `<div>`; the account panel's TP/SL button starts its name with "TP/SL". The chart's root no longer has `tabindex="1"`: it is focusable in document order (`tabindex="0"`), exposed as an image named after its instrument and timeframe ("ACME, 1m chart") and outlined on keyboard focus. Chart shortcuts (Shift+arrows, Shift+plus and minus) no longer swallow keys typed into fields inside Web Components such as the order ticket.
- b82b8b3: The trading overlay keeps every drawn order, exit and position line inside the price range the axis picks while it scales itself, so a far stop-loss stays on screen; `attachTrading(view, session, { autoscaleTradingLines: false })` scales to the bars only. Lines outside the visible prices (with the option off, or after scaling the axis by hand) get a compact marker at the top or bottom edge with an arrow, their label and their price on the axis. The engine gains `setAutoscaleValues(values, paneId?)`.
- b82b8b3: Price-axis tick labels no longer show half-covered next to the last price label ("111.60" sticking out of the "111.58" label) or next to the price labels of order, exit and position lines: the engine leaves out tick labels the last price label would cover, and the trading overlay hides those around its own labels, also while a line is dragged.

## 0.1.0-alpha.1

No changes in this release.

## 0.1.0-alpha.0

### Minor Changes

- 579b6da: The canvas rendering engine behind `@tickdeck/chart`, derived from KLineChart 10.0.4 (Apache-2.0), with a clean-room input handler and tickdeck names. Applications should use `@tickdeck/chart`.
- fadc6eb: The engine and the chart can be imported without a DOM (server-side rendering); they need one only once a chart is created.
