import { version } from '../package.json';

export const VERSION: string = version;

export type Side = 'buy' | 'sell';

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export { Emitter, type Listener, type Unsubscribe } from './emitter';
