---
"@tickdeck/chart": patch
---

The chart shows volume by default: `createChartView(container, { volume })` takes `'pane'` (default; a histogram in its own resizable pane below the prices, a fifth of the chart with compact K/M/B units), `'overlay'` (at the bottom of the price pane on a hidden scale of its own, never changing the price scale) or `'none'`; `setVolume(mode)` and the observable `volume` change and read it. The histogram hides itself while the bars carry no volume, follows realtime updates of the last bar, and its legend shows the hovered bar's volume. Bars use the new `--tdk-color-volume-up` and `--tdk-color-volume-down` tokens (`volumeUp`, `volumeDown` in `ChartColors`), by default the up and down colors at 50% opacity.
