import type { BrokerConnector } from '@tickdeck/broker';
import { Emitter } from '@tickdeck/core';
import type { MarketFeed } from '@tickdeck/datafeed';
import { version } from '../package.json';

export const VERSION: string = version;

export interface WidgetContext {
  feed: MarketFeed;
  broker: BrokerConnector;
}

export class WidgetController<State extends object> extends Emitter<{ change: State }> {
  readonly context: WidgetContext;
  #state: State;

  constructor(context: WidgetContext, initial: State) {
    super();
    this.context = context;
    this.#state = initial;
  }

  get state(): State {
    return this.#state;
  }

  protected update(patch: Partial<State>): void {
    this.#state = { ...this.#state, ...patch };
    this.emit('change', this.#state);
  }
}
