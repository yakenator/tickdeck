// Deterministic trading states for the stories: a MockFeed with a fixed seed,
// a fixed clock and no automatic ticks, a MockBroker and a BrokerSession,
// driven into a named state before the story renders.
import {
  BrokerSession,
  MockBroker,
  type BrokerConnector,
  type BrokerUpdateSink,
  type BrokerUpdates,
  type OrderRequest,
  type TradingRules,
} from '@tickdeck/broker';
import { addExact, multiplyExact, roundToTick, subtractExact, type Scheduler } from '@tickdeck/core';
import { MockFeed } from '@tickdeck/datafeed';

/** Every story sees the same moment, so history, quotes and order times never change: 2026-01-15 14:30 UTC. */
export const NOW = Date.UTC(2026, 0, 15, 14, 30);
export const INSTRUMENT = 'MOCK:ACME';
export const INSTRUMENTS = ['MOCK:ACME', 'MOCK:ES', 'MOCK:EURUSD', 'MOCK:BTCUSD'] as const;
const TICK = 0.01;

/** A fixed clock with real timers (acknowledgement deadlines, toast durations). */
export const fixedClock: Scheduler = {
  now: () => NOW,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type ScenarioState =
  /** Connected, nothing traded yet. */
  | 'empty'
  /** The broker never finishes connecting. */
  | 'connecting'
  /** Connecting fails after a moment (`FAILED_CONNECT_MS`): the session start rejects with `FAILED_CONNECT_REASON`. */
  | 'failed'
  /** A working limit buy with take-profit and stop-loss, and a working limit sell. */
  | 'working'
  /** One working limit order on each mock instrument. */
  | 'orders'
  /** An open long position with exits and unrealized P&L, plus a working order. */
  | 'position'
  /** An open long position whose take-profit and stop-loss are far outside the recent prices (±`FAR_EXIT_DISTANCE`). */
  | 'far-exits'
  /** A position opened and closed at a profit, a cancelled order, and the fills. */
  | 'history'
  /** Connected once, then the connection dropped. */
  | 'disconnected'
  /** An order the broker rejected (off-tick price). */
  | 'rejected';

export interface ScenarioOptions {
  state?: ScenarioState;
  /** Story id: the scenario is disposed when that story unmounts or re-renders. */
  owner?: string;
  /**
   * Hold back the broker's order updates, so actions are never acknowledged:
   * the ticket stays busy until `ackTimeoutMs` passes.
   */
  holdOrderUpdates?: boolean;
  /** Acknowledgement deadline. Default 10 s. */
  ackTimeoutMs?: number;
  /** Trading rules per instrument, overriding the feed (not tradable, quantity limits). */
  rules?: Record<string, Partial<TradingRules>>;
}

export interface Scenario {
  feed: MockFeed;
  broker: MockBroker;
  session: BrokerSession;
  instrument: string;
  /** The market's last price when the story starts. */
  price: number;
  /** Moves the market to `last` (one tick each side) and waits until the broker has reacted. */
  market(last: number): Promise<void>;
  /** Waits until every queued broker action and update has been delivered. */
  settle(): Promise<void>;
  /** Sends an order straight to the session, as another part of the app would. */
  submit(request: Omit<OrderRequest, 'instrument'> & { instrument?: string }): Promise<string>;
  dispose(): void;
}

const owned = new Map<string, Array<() => void>>();

/** Disposes every scenario created for one story. */
export function disposeOwner(owner: string): void {
  for (const dispose of owned.get(owner) ?? []) dispose();
  owned.delete(owner);
}

/** Wraps the broker so `filter` decides which updates reach the session. */
function filterUpdates(broker: MockBroker, pass: (type: keyof BrokerUpdates) => boolean): BrokerConnector {
  return new Proxy(broker, {
    get(target, key) {
      if (key === 'connect') {
        return (sink: BrokerUpdateSink) =>
          target.connect({
            emit: ((type: keyof BrokerUpdates, payload: never) => {
              if (pass(type)) sink.emit(type, payload);
            }) as BrokerUpdateSink['emit'],
          });
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Distance of the `far-exits` take-profit and stop-loss from the price: far beyond the 1m bars on screen. */
export const FAR_EXIT_DISTANCE = 8;

/** How long the `failed` connector takes to give up, so widgets first show that they are connecting. */
export const FAILED_CONNECT_MS = 400;
export const FAILED_CONNECT_REASON = 'Broker gateway unreachable (mock)';

/** A connector whose connection attempt fails after `FAILED_CONNECT_MS`. */
function failsToConnect(broker: MockBroker): BrokerConnector {
  return new Proxy(broker, {
    get(target, key) {
      if (key === 'connect') {
        return () =>
          new Promise<void>((_, reject) => globalThis.setTimeout(() => reject(new Error(FAILED_CONNECT_REASON)), FAILED_CONNECT_MS));
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** A connector that reports `connecting` and never completes the connection. */
function neverConnects(broker: MockBroker): BrokerConnector {
  return new Proxy(broker, {
    get(target, key) {
      if (key === 'connect') {
        return (sink: BrokerUpdateSink) => {
          sink.emit('connection', { state: 'connecting' });
          return new Promise<void>(() => {});
        };
      }
      if (key === 'getConnection') return async () => ({ state: 'connecting' as const });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const price2 = (value: number) => roundToTick(value, TICK);

export async function createScenario(options: ScenarioOptions = {}): Promise<Scenario> {
  const { state = 'empty', owner, holdOrderUpdates = false, ackTimeoutMs, rules } = options;
  const feed = new MockFeed({ seed: 7, autoTick: false, scheduler: fixedClock });
  const broker = new MockBroker({ feed, scheduler: fixedClock, startingBalance: 100_000, rules });
  let holding = false;
  const connector =
    state === 'connecting'
      ? neverConnects(broker)
      : state === 'failed'
        ? failsToConnect(broker)
        : filterUpdates(broker, (type) => !(holding && type === 'order'));
  const session = new BrokerSession(connector, { scheduler: fixedClock, ackTimeoutMs });

  const [quote] = await feed.loadQuotes([INSTRUMENT]);
  const price = price2(quote?.last ?? 100);

  const settle = async () => {
    await broker.idle();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const market = async (last: number) => {
    await feed.setQuote(INSTRUMENT, { bid: subtractExact(last, TICK), ask: addExact(last, TICK), last });
    await settle();
  };
  const submit: Scenario['submit'] = (request) => session.submitOrder({ instrument: INSTRUMENT, ...request } as OrderRequest);

  let disposed = false;
  const scenario: Scenario = {
    feed,
    broker,
    session,
    instrument: INSTRUMENT,
    price,
    market,
    settle,
    submit,
    dispose() {
      if (disposed) return;
      disposed = true;
      void session.stop().catch(() => {});
      feed.dispose();
    },
  };
  if (owner) owned.set(owner, [...(owned.get(owner) ?? []), () => scenario.dispose()]);

  if (state === 'connecting' || state === 'failed') {
    // The story renders while the session connects; a failed start is shown by the widgets, not thrown here.
    session.start().catch(() => {});
    return scenario;
  }
  await session.start();
  await market(price);

  switch (state) {
    case 'working':
      await submit({ side: 'buy', kind: 'limit', quantity: 10, limitPrice: price2(price - 0.5), takeProfit: price2(price + 0.75), stopLoss: price2(price - 1) });
      await submit({ side: 'sell', kind: 'limit', quantity: 5, limitPrice: price2(price + 1.2) });
      break;
    case 'orders':
      for (const [index, id] of INSTRUMENTS.entries()) {
        const info = await feed.getInstrument(id);
        const [quote] = await feed.loadQuotes([id]);
        const buy = index % 2 === 0;
        const offset = multiplyExact(info.tickSize, 40);
        await submit({
          instrument: id,
          side: buy ? 'buy' : 'sell',
          kind: 'limit',
          quantity: multiplyExact(info.quantity.min, index + 1),
          limitPrice: roundToTick(buy ? subtractExact(quote?.bid ?? 0, offset) : addExact(quote?.ask ?? 0, offset), info.tickSize),
        });
      }
      break;
    case 'position': {
      await submit({ side: 'buy', kind: 'market', quantity: 10 });
      await settle();
      const [position] = session.positions;
      if (position) await session.setPositionExits(position.id, { takeProfit: price2(price + 1), stopLoss: price2(price - 0.8) });
      await submit({ side: 'sell', kind: 'limit', quantity: 5, limitPrice: price2(price + 1.2) });
      await market(price2(price + 0.35));
      break;
    }
    case 'far-exits': {
      await submit({ side: 'buy', kind: 'market', quantity: 10 });
      await settle();
      const [position] = session.positions;
      if (position) {
        await session.setPositionExits(position.id, { takeProfit: price2(price + FAR_EXIT_DISTANCE), stopLoss: price2(price - FAR_EXIT_DISTANCE) });
      }
      break;
    }
    case 'history': {
      await submit({ side: 'buy', kind: 'market', quantity: 10 });
      await settle();
      const cancelled = await submit({ side: 'buy', kind: 'limit', quantity: 3, limitPrice: price2(price - 2) });
      await settle();
      await session.cancelOrder(cancelled);
      await market(price2(price + 0.6));
      const [position] = session.positions;
      if (position) await session.closePosition(position.id);
      break;
    }
    case 'disconnected':
      await broker.disconnect();
      break;
    case 'rejected':
      await submit({ side: 'buy', kind: 'limit', quantity: 10, limitPrice: price - 0.005 });
      break;
  }
  await settle();
  holding = holdOrderUpdates;
  return scenario;
}

export const round2 = (value: number) => Math.round(value * 100) / 100;

/** Storybook loader: `parameters.scenario` picks the state; the story owns the result. */
export async function loadScenario({ id, parameters }: { id: string; parameters: { scenario?: ScenarioOptions } }) {
  return { scenario: await createScenario({ ...parameters.scenario, owner: id }) };
}
