---
"@tickdeck/chart": patch
"@tickdeck/chart-engine": patch
---

The trading overlay keeps every drawn order, exit and position line inside the price range the axis picks while it scales itself, so a far stop-loss stays on screen; `attachTrading(view, session, { autoscaleTradingLines: false })` scales to the bars only. Lines outside the visible prices (with the option off, or after scaling the axis by hand) get a compact marker at the top or bottom edge with an arrow, their label and their price on the axis. The engine gains `setAutoscaleValues(values, paneId?)`.
