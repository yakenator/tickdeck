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
export {
  attachTrading,
  type TradingActionErrorEvent,
  type TradingActionEvent,
  type TradingOverlay,
  type TradingOverlayEvents,
  type TradingOverlayOptions,
} from './trading/overlay';
export {
  buildTradingScene,
  formatPositionPnl,
  type FillMarker,
  type PnlUnit,
  type PositionPnl,
  type TradingLine,
  type TradingLineEdit,
  type TradingLineGroup,
  type TradingLineKind,
  type TradingLineTarget,
  type TradingScene,
  type TradingSceneInput,
  type TradingVisibility,
} from './trading/scene';
export {
  TradingEdits,
  lineTargetIds,
  planLineMove,
  planLineRemoval,
  runTradingAction,
  type TradingAction,
} from './trading/actions';
