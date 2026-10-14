---
"@tickdeck/chart-engine": patch
"@tickdeck/chart": patch
---

Price-axis tick labels no longer show half-covered next to the last price label ("111.60" sticking out of the "111.58" label) or next to the price labels of order, exit and position lines: the engine leaves out tick labels the last price label would cover, and the trading overlay hides those around its own labels, also while a line is dragged.
