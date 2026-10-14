import type { Bar } from '@tickdeck/core';

/** How bars are drawn: candlesticks, OHLC bars, a close-price line, or a line with a flat filled area. */
export type ChartStyle = 'candles' | 'bars' | 'line' | 'area';

/**
 * Price axis scale:
 * - `normal`: linear prices;
 * - `log`: logarithmic prices;
 * - `percent`: change from the first visible bar's close, in percent;
 * - `indexed`: prices relative to the first visible bar's close, which reads as 100.
 */
export type PriceScaleMode = 'normal' | 'log' | 'percent' | 'indexed';

/** How volume is shown: in its own pane below the prices, at the bottom of the price pane, or not at all. */
export type VolumeMode = 'pane' | 'overlay' | 'none';

/** Where the pointer is over the chart. */
export interface ChartCrosshair {
  /** Open time of the bar under the pointer, UTC epoch milliseconds. Extrapolated past the loaded bars. */
  time?: number;
  /** Price under the pointer, rounded to the instrument's tick size. Unset outside the price pane. */
  price?: number;
  /** The loaded bar under the pointer. */
  bar?: Bar;
}

/** A snapshot of what a chart shows. */
export interface ChartState {
  instrument: string;
  timeframe: string;
  style: ChartStyle;
  priceScaleMode: PriceScaleMode;
  volume: VolumeMode;
  /** Loaded bars, oldest first. */
  bars: readonly Bar[];
}
