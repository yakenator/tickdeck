import type { BrokerConnection, BrokerSession } from '@tickdeck/broker';
import type { QuoteSource, Scheduler } from '@tickdeck/core';
import type { MarketFeed } from '@tickdeck/datafeed';

/**
 * What widgets need from the market data side: quotes, and instrument
 * metadata (display name, price precision) when the feed can resolve it.
 * Any `MarketFeed` fits.
 */
export interface WidgetFeed extends QuoteSource {
  getInstrument?: MarketFeed['getInstrument'];
}

/** Everything a widget controller works with. */
export interface WidgetContext {
  /** Trading state and actions. Widgets never talk to the connector directly. */
  session: BrokerSession;
  /** Live bid and ask for tickets and trade buttons, and instrument names. Optional for the account panel. */
  feed?: WidgetFeed;
  /** Clock and timers (auto-dismiss, confirmation windows). Default: the host's. */
  scheduler?: Scheduler;
  /** IANA timezone used to display times. Default: the host's. */
  timeZone?: string;
}

/** Whether a widget can be used right now. `connecting` while the session connects, `disconnected` when it is not connected or failed. */
export type WidgetAvailability = 'no-instrument' | 'loading' | 'ready' | 'connecting' | 'disconnected' | 'not-tradable' | 'error';

/** Why a trading widget cannot be used because of the broker connection, or `undefined` when connected. */
export function connectionAvailability(
  connection: BrokerConnection,
): { availability: 'connecting' | 'disconnected'; reason: string } | undefined {
  if (connection.state === 'connected') return undefined;
  if (connection.state === 'connecting') return { availability: 'connecting', reason: connection.message ?? 'Connecting to the broker…' };
  return { availability: 'disconnected', reason: connection.message ?? 'Not connected to the broker' };
}

/** Outcome of the last action, shown next to the control that started it. */
export interface ActionResult {
  level: 'success' | 'info' | 'error';
  message: string;
  orderId?: string;
}
