# @tickdeck/chart

## 0.1.0-alpha.2

### Patch Changes

- b82b8b3: Accessibility (WCAG 2.5.3 Label in Name, 4.1.2): the order ticket's Bid and Ask buttons read "Bid 111.22" on screen as in their names; the trade buttons are named by their visible text ("Sell 111.22") and describe the order and any reason they are disabled through `aria-describedby`; the spread between them is plain text instead of an `aria-label` on a `<div>`; the account panel's TP/SL button starts its name with "TP/SL". The chart's root no longer has `tabindex="1"`: it is focusable in document order (`tabindex="0"`), exposed as an image named after its instrument and timeframe ("ACME, 1m chart") and outlined on keyboard focus. Chart shortcuts (Shift+arrows, Shift+plus and minus) no longer swallow keys typed into fields inside Web Components such as the order ticket.
- b82b8b3: The trading overlay keeps every drawn order, exit and position line inside the price range the axis picks while it scales itself, so a far stop-loss stays on screen; `attachTrading(view, session, { autoscaleTradingLines: false })` scales to the bars only. Lines outside the visible prices (with the option off, or after scaling the axis by hand) get a compact marker at the top or bottom edge with an arrow, their label and their price on the axis. The engine gains `setAutoscaleValues(values, paneId?)`.
- b82b8b3: Price-axis tick labels no longer show half-covered next to the last price label ("111.60" sticking out of the "111.58" label) or next to the price labels of order, exit and position lines: the engine leaves out tick labels the last price label would cover, and the trading overlay hides those around its own labels, also while a line is dragged.
- 1992b83: The chart shows volume by default: `createChartView(container, { volume })` takes `'pane'` (default; a histogram in its own resizable pane below the prices, a fifth of the chart with compact K/M/B units), `'overlay'` (at the bottom of the price pane on a hidden scale of its own, never changing the price scale) or `'none'`; `setVolume(mode)` and the observable `volume` change and read it. The histogram hides itself while the bars carry no volume, follows realtime updates of the last bar, and its legend shows the hovered bar's volume. Bars use the new `--tdk-color-volume-up` and `--tdk-color-volume-down` tokens (`volumeUp`, `volumeDown` in `ChartColors`), by default the up and down colors at 50% opacity.
- b82b8b3: Elements fill the space their layout gives them: the host is a flex column (`display: flex`) whose visible box grows to the host's height, so a ticket stretched next to a chart ends at the chart's bottom; without an imposed height an element keeps its natural height, and a short account panel scrolls its table. A chart whose container is sized by a grid or flex row now shrinks again when the row does (its canvases no longer hold the container at its previous height). The READMEs and examples show one equal-height pattern for a chart and a column of widgets.
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
  - @tickdeck/chart-engine@0.1.0-alpha.2
  - @tickdeck/broker@0.1.0-alpha.2
  - @tickdeck/core@0.1.0-alpha.2
  - @tickdeck/datafeed@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies
  - @tickdeck/core@0.1.0-alpha.1
  - @tickdeck/broker@0.1.0-alpha.1
  - @tickdeck/datafeed@0.1.0-alpha.1
  - @tickdeck/chart-engine@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- fadc6eb: The engine and the chart can be imported without a DOM (server-side rendering); they need one only once a chart is created.
- 0c1a450: Add the chart view: `createChartView` shows one instrument and timeframe from a `MarketFeed`, pages history in as the user scrolls left, streams realtime bars, and switches chart style (candles, bars, line, area), price scale (normal, log, percent, indexed) and light or dark flat themes. `attachTrading` draws a `BrokerSession`'s working orders, take-profit and stop-loss exits, positions with live P&L and fills, and turns dragging and the cancel and close buttons into broker calls. `BarSeries`, `buildTradingScene` and the action planners are usable without a chart. `ChartView` no longer exposes the engine.

### Patch Changes

- Updated dependencies [579b6da]
- Updated dependencies [fadc6eb]
- Updated dependencies [579b6da]
- Updated dependencies [8b73334]
  - @tickdeck/chart-engine@0.1.0-alpha.0
  - @tickdeck/core@0.1.0-alpha.0
  - @tickdeck/datafeed@0.1.0-alpha.0
  - @tickdeck/broker@0.1.0-alpha.0
