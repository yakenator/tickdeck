// Shared setup for the controller tests. Not exported from the package.
import {
  BrokerSession,
  MockBroker,
  type BrokerSessionOptions,
  type BrokerUpdateSink,
  type MockBrokerOptions,
} from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import type { WidgetContext } from './context';

export const ACME = 'MOCK:ACME';
export const NOW = Date.UTC(2026, 9, 14, 12, 0, 30);

/** Lets promise chains (controller reactions, instrument loads) run to the end. */
export async function flush(turns = 30): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

/** A `MockBroker` that exposes its update sink, to push arbitrary updates. */
export class SpyBroker extends MockBroker {
  sink: BrokerUpdateSink | undefined;

  override connect(sink: BrokerUpdateSink): Promise<void> {
    this.sink = sink;
    return super.connect(sink);
  }
}

export interface TradingSetupOptions {
  broker?: Partial<MockBrokerOptions>;
  session?: BrokerSessionOptions;
  /** Start the session. Default true. */
  start?: boolean;
  createBroker?: (options: MockBrokerOptions) => MockBroker;
}

export async function setupTrading(options: TradingSetupOptions = {}) {
  const feed = new MockFeed({ autoTick: false });
  const brokerOptions: MockBrokerOptions = { feed, ...options.broker };
  const broker = options.createBroker ? options.createBroker(brokerOptions) : new SpyBroker(brokerOptions);
  const session = new BrokerSession(broker, options.session);
  if (options.start !== false) await session.start();
  const context: WidgetContext = { session, feed, timeZone: 'Etc/UTC' };
  const settle = async () => {
    await broker.idle();
    await flush();
  };
  const quote = async (bid: number, ask: number, instrument = ACME) => {
    await feed.setQuote(instrument, { bid, ask });
    await settle();
  };
  return { feed, broker, session, context, settle, quote };
}
