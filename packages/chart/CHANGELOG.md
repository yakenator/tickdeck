# @tickdeck/chart

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
