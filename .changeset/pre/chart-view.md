---
"@tickdeck/chart": minor
---

Add the chart view: `createChartView` shows one instrument and timeframe from a `MarketFeed`, pages history in as the user scrolls left, streams realtime bars, and switches chart style (candles, bars, line, area), price scale (normal, log, percent, indexed) and light or dark flat themes. `attachTrading` draws a `BrokerSession`'s working orders, take-profit and stop-loss exits, positions with live P&L and fills, and turns dragging and the cancel and close buttons into broker calls. `BarSeries`, `buildTradingScene` and the action planners are usable without a chart. `ChartView` no longer exposes the engine.
