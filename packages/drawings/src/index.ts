import type { ChartState } from '@tickdeck/chart';
import { version } from '../package.json';

export const VERSION: string = version;

export interface Anchor {
  time: number;
  price: number;
}

export interface DrawingTool {
  id: string;
  anchorCount: number;
  hitTest(chart: ChartState, anchors: readonly Anchor[], x: number, y: number): boolean;
}
