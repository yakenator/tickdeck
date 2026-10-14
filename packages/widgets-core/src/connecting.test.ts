import type { BrokerUpdateSink, MockBrokerOptions } from '@tickdeck/broker';
import { describe, expect, it } from 'vitest';
import { AccountPanelController } from './account-panel';
import { NotificationCenter } from './notifications';
import { OrderTicketController } from './order-ticket';
import { ACME, SpyBroker, flush, setupTrading } from './test-setup';
import { TradeButtonsController } from './trade-buttons';

/** A mock broker whose `connect` waits until the test opens or fails it. */
class GatedBroker extends SpyBroker {
  open: () => void = () => {};
  fail: (error: Error) => void = () => {};
  readonly #gate: Promise<void>;

  constructor(options: MockBrokerOptions) {
    super(options);
    this.#gate = new Promise((resolve, reject) => {
      this.open = resolve;
      this.fail = reject;
    });
  }

  override async connect(sink: BrokerUpdateSink): Promise<void> {
    await this.#gate;
    return super.connect(sink);
  }
}

async function startingSession() {
  const trading = await setupTrading({ start: false, createBroker: (options) => new GatedBroker(options) });
  await trading.quote(100, 100.02);
  const { context, session } = trading;
  const widgets = {
    ticket: new OrderTicketController(context, { instrument: ACME, kind: 'limit' }),
    buttons: new TradeButtonsController(context, { instrument: ACME }),
    panel: new AccountPanelController(context),
    center: new NotificationCenter(context),
  };
  const starting = session.start();
  await flush();
  return { ...trading, ...widgets, broker: trading.broker as GatedBroker, starting };
}

describe('while the session connects', () => {
  it('every widget says it is connecting, then becomes usable', async () => {
    const { ticket, buttons, panel, center, broker, starting, settle } = await startingSession();
    const connecting = { availability: 'connecting', reason: 'Connecting to the broker…' };
    expect(ticket.state.value).toMatchObject({ ...connecting, canSubmit: false });
    expect(buttons.state.value).toMatchObject({ ...connecting, buy: { enabled: false, reason: 'Connecting to the broker…' } });
    expect(panel.state.value.status).toBe('connecting');

    broker.open();
    await starting;
    await settle();
    expect(ticket.state.value.availability).toBe('ready');
    expect(buttons.state.value).toMatchObject({ availability: 'ready', buy: { enabled: true } });
    expect(panel.state.value.status).toBe('ready');
    expect(center.state.value.log).toEqual([]);
  });

  it('a failed connection disables trading with the reason and is announced', async () => {
    const { ticket, buttons, panel, center, broker, starting, settle } = await startingSession();
    broker.fail(new Error('Network down'));
    await expect(starting).rejects.toThrow('Network down');
    await settle();

    expect(ticket.state.value).toMatchObject({ availability: 'disconnected', reason: 'Network down' });
    expect(buttons.state.value).toMatchObject({ availability: 'disconnected', sell: { enabled: false, reason: 'Network down' } });
    expect(panel.state.value).toMatchObject({ status: 'disconnected', message: 'Network down' });
    expect(center.state.value.toasts.map((toast) => [toast.level, toast.title, toast.message])).toEqual([
      ['error', 'Could not connect to the broker', 'Network down'],
    ]);
  });
});
