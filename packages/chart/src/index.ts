import type { Chart as EngineChart } from '@tickdeck/chart-engine';
import type { Bar } from '@tickdeck/core';
import { version } from '../package.json';

export const VERSION: string = version;

export type SeriesStyle = 'candles' | 'bars' | 'line' | 'area';
export type ScaleMode = 'linear' | 'logarithmic' | 'percent' | 'indexed';

export interface ChartState {
  instrument: string;
  timeframe: string;
  style: SeriesStyle;
  scale: ScaleMode;
  bars: readonly Bar[];
}

export interface ChartView {
  state: ChartState;
  engine: EngineChart;
}
