import { version } from '../package.json';

export const VERSION: string = version;

export type { ChartCrosshair, ChartState, ChartStyle, PriceScaleMode } from './types';
export {
  createChartView,
  type ChartView,
  type ChartViewError,
  type ChartViewEvents,
  type ChartViewOptions,
} from './chart-view';
export { BarSeries, type BarSeriesChange, type BarSeriesEvents, type BarSeriesOptions } from './bar-series';
export {
  chartThemes,
  readChartColorTokens,
  resolveChartColors,
  type ChartColors,
  type ChartThemeName,
} from './theme';
