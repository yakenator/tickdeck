// @vitest-environment happy-dom
import { BrokerSession, MockBroker, type BrokerUpdateSink } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import { ACME, flush, query, rendered, text } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

/** A mock broker whose `connect` waits until the test opens or fails it. */
class GatedBroker extends MockBroker {
  open: () => void = () => {};
  fail: (error: Error) => void = () => {};
  readonly #gate = new Promise<void>((resolve, reject) => {
    this.open = resolve;
    this.fail = reject;
  });

  override async connect(sink: BrokerUpdateSink): Promise<void> {
    await this.#gate;
    return super.connect(sink);
  }
}

async function mountWhileConnecting() {
  const feed = new MockFeed({ autoTick: false });
  const broker = new GatedBroker({ feed });
  const session = new BrokerSession(broker);
  const ticket = document.createElement('tdk-order-ticket');
  ticket.instrument = ACME;
  ticket.kind = 'limit';
  const buttons = document.createElement('tdk-trade-buttons');
  buttons.instrument = ACME;
  const panel = document.createElement('tdk-account-panel');
  for (const element of [ticket, buttons, panel]) {
    element.session = session;
    element.feed = feed;
  }
  document.body.append(ticket, buttons, panel);
  const starting = session.start();
  await feed.setQuote(ACME, { bid: 100, ask: 100.02 });
  const settled = async () => {
    await broker.idle();
    await flush();
    for (const element of [ticket, buttons, panel]) await rendered(element);
  };
  await settled();
  return { broker, session, ticket, buttons, panel, starting, settled };
}

describe('while the session connects', () => {
  it('the widgets say "Connecting to the broker…", then become usable', async () => {
    const { broker, ticket, buttons, panel, starting, settled } = await mountWhileConnecting();
    expect(text(query(ticket, '[part="status"]'))).toBe('Connecting to the broker…');
    expect(query<HTMLButtonElement>(ticket, '[part~="submit-button"]').disabled).toBe(true);
    expect(text(query(buttons, '[part="reason"]'))).toBe('Connecting to the broker…');
    expect(query<HTMLButtonElement>(buttons, '[part~="buy-button"]').disabled).toBe(true);
    expect(text(query(panel, '[part="status"]'))).toBe('Connecting to the broker…');

    broker.open();
    await starting;
    await settled();
    expect(ticket.shadowRoot!.querySelector('[part="status"]')).toBeNull();
    expect(query<HTMLButtonElement>(ticket, '[part~="submit-button"]').disabled).toBe(false);
    expect(query(buttons, '[part="reason"]').hidden).toBe(true);
    expect(query<HTMLButtonElement>(buttons, '[part~="buy-button"]').disabled).toBe(false);
    expect(panel.shadowRoot!.querySelector('[part="status"]')).toBeNull();
  });

  it('a failed connection shows the reason', async () => {
    const { broker, ticket, buttons, panel, starting, settled } = await mountWhileConnecting();
    broker.fail(new Error('Network down'));
    await expect(starting).rejects.toThrow('Network down');
    await settled();
    expect(text(query(ticket, '[part="status"]'))).toBe('Network down');
    expect(text(query(buttons, '[part="reason"]'))).toBe('Network down');
    expect(text(query(panel, '[part="status"]'))).toBe('Not connected to the broker: Network down');
  });
});
