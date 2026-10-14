import type { ChartState } from '@tickdeck/chart';
import { version } from '../package.json';

export const VERSION: string = version;

export interface IndicatorDefinition<Params extends object = object> {
  id: string;
  overlay: boolean;
  compute(chart: ChartState, params: Params): number[];
}
