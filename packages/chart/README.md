# @tickdeck/chart

A price chart for one instrument and timeframe, fed by any `MarketFeed`: history pages in as the user scrolls left, realtime bars stream in, and a trading overlay draws a `BrokerSession`'s orders, exits, positions and fills, which the user can drag, cancel and close on the chart. It wraps the tickdeck rendering engine, so the rest of the library never talks to the engine directly.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/chart
```

## Usage

```ts
import { createChartView, attachTrading } from '@tickdeck/chart';
import { MockFeed } from '@tickdeck/datafeed';
import { BrokerSession, MockBroker } from '@tickdeck/broker';

const feed = new MockFeed();
const session = new BrokerSession(new MockBroker({ feed }));
await session.start();

// The container needs a size; the chart fills it and follows it when it resizes.
const view = createChartView(document.querySelector('#chart')!, {
  feed,
  instrument: 'MOCK:ACME',
  timeframe: '5m',
  style: 'candles',
  theme: 'dark',
});

view.loading.subscribe((loading) => spinner.toggle(loading));
view.crosshair.subscribe((point) => {
  status.textContent = point?.price === undefined ? '' : view.formatPrice(point.price);
});
view.on('error', ({ operation, error }) => console.warn(operation, error));

view.setTimeframe('1h');
view.setChartStyle('area');
view.setPriceScaleMode('log');
await view.setInstrument('MOCK:ES');

const trading = attachTrading(view, session, { pnl: ['money', 'ticks'] });
trading.on('actionError', ({ action, error }) => toast(`${action.type} failed: ${error}`));
trading.setVisibility({ fills: false });

// Later
view.dispose(); // also disposes the trading overlay
```

## `createChartView(container, options)`

| Option | Default | |
|---|---|---|
| `feed` | | The `MarketFeed` that serves instruments, history and realtime bars |
| `instrument` | | Instrument id, resolved with `feed.getInstrument` |
| `timeframe` | | `1m`, `5m`, `1h`, `1D`, ... (see `parseTimeframe` in `@tickdeck/datafeed`) |
| `style` | `'candles'` | `'candles' \| 'bars' \| 'line' \| 'area'` |
| `priceScaleMode` | `'normal'` | `'normal' \| 'log' \| 'percent' \| 'indexed'` |
| `theme` | `'light'` | `'light' \| 'dark'` |
| `colors` | | `Partial<ChartColors>` applied over the theme and the container's tokens |
| `pageSize` | `500` | Bars asked for per history page |
| `timezone` | the browser's | IANA timezone of the time axis |
| `scheduler` | the host's | Clock for history requests |

### `ChartView`

| Member | |
|---|---|
| `instrument`, `instrumentInfo` | Observable id (the requested one while it resolves, the previous one again if that fails) and resolved `Instrument` |
| `timeframe`, `chartStyle`, `priceScaleMode`, `theme`, `colors` | Observable settings |
| `loading` | Observable: the instrument or a history page is loading |
| `crosshair` | Observable `{ time, price, bar }` under the pointer (price rounded to the tick), or `undefined` |
| `bars`, `endOfHistory`, `getState()` | Loaded bars (oldest first) and a `ChartState` snapshot |
| `on('bars' \| 'error', listener)` | Bar changes (`reset`, `older`, `update`, `append`) and failed feed requests |
| `setInstrument(id)` | Resolves when the instrument metadata arrived; rejects (and emits `error`) on failure |
| `setTimeframe`, `setChartStyle`, `setPriceScaleMode`, `setTheme(theme, colors?)` | Change what is shown |
| `formatPrice(price)`, `snapPrice(price)` | Format with the instrument's `pricePrecision`, round to its `tickSize` |
| `toPixel({ time, price })`, `fromPixel({ x, y })` | Convert between chart values and pixels relative to the container |
| `reload()`, `resize()`, `scrollToRealtime()`, `dispose()` | |

### Data loading

- The first request asks for `pageSize` bars ending now (`firstPage: true`). Realtime bars from `streamBars` start at the same time; any that arrive before the page are merged into it.
- When the user scrolls to the left edge, the page before the oldest bar loads (`to` is the oldest bar's time). An empty page with `olderBarTime` jumps over the gap; `endOfHistory`, or an empty page without `olderBarTime`, stops paging.
- A realtime bar with the newest bar's time replaces it, a later one is appended, an older one is ignored.
- `onHistoryChanged` from the feed drops the loaded bars and loads them again.
- Answers that arrive after the instrument or timeframe changed are dropped.

`BarSeries` is this logic on its own, without any DOM, for custom charts:

```ts
const series = new BarSeries(feed, { instrument: 'MOCK:ACME', timeframe: '1m' }, { pageSize: 300 });
series.on('change', (change) => render(series.bars, change));
await series.loadInitial();
await series.loadOlder();
```

### Styles, scales and themes

- `line` draws the close prices; `area` adds a flat, semi-transparent fill under the line. No style uses gradients.
- `percent` shows the change from the first visible bar's close; `indexed` shows prices relative to it, where that close reads as 100.
- Colors are flat. A theme picks the built-in light or dark set (`chartThemes`); `--tdk-*` custom properties on the container (or inherited by it) take precedence, and `colors` overrides both. They are read at creation and on every `setTheme` call.

| Token | Colors |
|---|---|
| `--tdk-color-surface` | `background` |
| `--tdk-color-text`, `--tdk-color-text-muted` | `text`, `textMuted` and the crosshair |
| `--tdk-color-grid`, `--tdk-color-border` | `grid`, `border` |
| `--tdk-color-accent` | `line` (and the area fill, derived from it) |
| `--tdk-color-buy`, `--tdk-color-sell` | Rising and falling bars, buy and sell orders and fills |
| `--tdk-color-take-profit`, `--tdk-color-stop-loss`, `--tdk-color-position` | Trading overlay lines |
| `--tdk-font-family` | Every text on the chart |

## `attachTrading(view, session, options)`

Draws the session's state for the chart's instrument and keeps it in sync with every `order`, `position`, `fill`, `pnl` and `resync` update.

| Drawn | Line | Gesture |
|---|---|---|
| Working limit and stop orders (stop-limit: both prices) | Dashed, buy or sell color, label such as `BUY LMT 10`, price tag on the axis | Drag to amend the price; `×` cancels |
| Take-profit and stop-loss of an entry order | Dashed, take-profit or stop-loss color, `TP 10` / `SL 10` | Drag to amend the entry's exit; `×` removes it |
| Positions | Solid, position color, `LONG 10` with unrealized P&L | `×` closes the position |
| Take-profit and stop-loss of a position | Dashed, `TP 10` / `SL 10` | Drag to move the exit (`setPositionExits`, or the exit order's amendment when the broker has no position exits); `×` removes it |
| Recent fills | A small triangle at the fill's bar and price | |

- Dragging rounds to the tick size and shows the new price on the line while the button is held. After the drop the line keeps the new price, marked as pending, until the broker confirms. If the broker rejects the change or does not confirm it within the session's acknowledgement deadline, the line goes back and `actionError` is emitted.
- Unrealized P&L comes from the broker (`unrealizedPnl` on positions and `pnl` updates). Without it, the position is marked at the last bar's close. `pnl: ['money', 'ticks', 'percent']` picks what the label shows.
- Lines that cannot change (no amendments, or a position) are not draggable; controls the broker does not support are not shown.

| Member | |
|---|---|
| `scene` | Observable `TradingScene`: the lines and fill markers drawn right now |
| `visibility`, `setVisibility({ orders, positions, fills })` | Toggle groups; exits follow what they protect |
| `moveLine(lineId, price)`, `removeLine(lineId)` | The drag and `×` gestures, for keyboard or menu use |
| `on('action' \| 'actionError', listener)` | Broker calls sent from the chart, and the ones that failed |
| `dispose()` | Removes the drawings. Disposing the view disposes its overlays |

The mapping and the broker calls are plain functions, usable without a chart: `buildTradingScene` turns orders, positions and fills into lines and markers, `planLineMove` and `planLineRemoval` pick the broker call for a gesture, and `TradingEdits` tracks unconfirmed changes.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
