import type { Bar, Unsubscribe } from '@tickdeck/core';
import { version } from '../package.json';

export const VERSION: string = version;

export interface HistoryRequest {
  instrument: string;
  timeframe: string;
  from: number;
  to: number;
}

export interface MarketFeed {
  loadHistory(request: HistoryRequest): Promise<Bar[]>;
  streamBars(instrument: string, timeframe: string, onBar: (bar: Bar) => void): Unsubscribe;
}
