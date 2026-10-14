// Shared setup for the element tests. Not exported from the package.
import { BrokerSession, MockBroker, type MockBrokerOptions } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';

export const ACME = 'MOCK:ACME';

export async function flush(turns = 30): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

export async function setupTrading(options: Partial<MockBrokerOptions> = {}) {
  const feed = new MockFeed({ autoTick: false });
  const broker = new MockBroker({ feed, ...options });
  const session = new BrokerSession(broker);
  await session.start();
  const settle = async () => {
    await broker.idle();
    await flush();
  };
  const quote = async (bid: number, ask: number, instrument = ACME) => {
    await feed.setQuote(instrument, { bid, ask });
    await settle();
  };
  return { feed, broker, session, settle, quote };
}

/** Waits for pending trading work and the element's next render. */
export async function rendered(element: HTMLElement & { updateComplete: Promise<boolean> }): Promise<void> {
  await flush();
  await element.updateComplete;
}

export function shadow(element: HTMLElement): ShadowRoot {
  if (!element.shadowRoot) throw new Error(`${element.localName} has no shadow root`);
  return element.shadowRoot;
}

export function query<T extends Element = HTMLElement>(element: HTMLElement, selector: string): T {
  const found = shadow(element).querySelector<T>(selector);
  if (!found) throw new Error(`Nothing matches ${selector} in ${element.localName}`);
  return found;
}

export function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

export function key(target: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

export function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}
