import type { ChartState } from '@tickdeck/chart';
import { version } from '../package.json';

export const VERSION: string = version;

export const MAX_CHARTS = 8;

export type LinkTarget = 'instrument' | 'timeframe' | 'crosshair' | 'time' | 'range';

export interface LayoutState {
  charts: readonly ChartState[];
  activeIndex: number;
  linked: ReadonlySet<LinkTarget>;
}
