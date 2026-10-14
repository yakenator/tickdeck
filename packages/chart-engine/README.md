# @tickdeck/chart-engine

The canvas rendering engine behind `@tickdeck/chart`: series, axes, panes, crosshair, built-in indicators and drawing overlays.

> Being refactored for tickdeck; the API will change. Applications should use `@tickdeck/chart`, which wraps this package.

## Origin

Derived from [KLineChart](https://github.com/klinecharts/KLineChart) by liihuu, licensed under Apache-2.0. The source was imported from upstream commit [`8387c9f6a53f`](https://github.com/klinecharts/KLineChart/commit/8387c9f6a53f) (KLineChart 10.0.4), and all changes since then are made in this repository.

`src/common/EventHandler.ts` derives from Lightweight Charts (Apache-2.0, see `licenses/LICENSE-lightweight-charts`) and is scheduled for replacement.

## Install

```sh
npm install @tickdeck/chart-engine
```

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0; see `LICENSE`, `NOTICE` and `licenses/`.
