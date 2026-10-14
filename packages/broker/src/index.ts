import type { Emitter, Side } from '@tickdeck/core';
import { version } from '../package.json';

export const VERSION: string = version;

export type OrderKind = 'market' | 'limit' | 'stop';
export type OrderState = 'pending' | 'held' | 'open' | 'filled' | 'cancelled' | 'rejected';

export interface OrderRequest {
  instrument: string;
  side: Side;
  kind: OrderKind;
  quantity: number;
  price?: number;
}

export interface OrderUpdate {
  id: string;
  state: OrderState;
  filledQuantity: number;
}

export interface BrokerUpdates {
  order: OrderUpdate;
}

export type BrokerUpdateSink = Pick<Emitter<BrokerUpdates>, 'emit'>;

export interface BrokerConnector {
  connect(sink: BrokerUpdateSink): Promise<void>;
  submitOrder(request: OrderRequest): Promise<string>;
}
