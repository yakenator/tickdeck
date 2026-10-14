// Helpers for play functions: the widgets render into open shadow roots,
// which Testing Library queries do not enter.
import { userEvent, waitFor } from 'storybook/test';

type Host = Element & { shadowRoot: ShadowRoot | null };

/** The tdk-* element of a tag in the story canvas. */
export function widget<K extends keyof HTMLElementTagNameMap>(canvasElement: HTMLElement, tag: K): HTMLElementTagNameMap[K] {
  const found = canvasElement.querySelector(tag);
  if (!found) throw new Error(`No <${tag}> in the story`);
  return found;
}

/** The first node matching `selector` in a widget's shadow root. */
export function part<T extends HTMLElement = HTMLElement>(host: Host, selector: string): T {
  const found = host.shadowRoot?.querySelector<T>(selector);
  if (!found) throw new Error(`<${host.localName}> has no ${selector}`);
  return found;
}

export function parts<T extends HTMLElement = HTMLElement>(host: Host, selector: string): T[] {
  return [...(host.shadowRoot?.querySelectorAll<T>(selector) ?? [])];
}

/** Waits until `selector` exists in the widget's shadow root. */
export function findPart<T extends HTMLElement = HTMLElement>(host: Host, selector: string, timeout = 4000): Promise<T> {
  return waitFor(() => part<T>(host, selector), { timeout });
}

/** Replaces the text of an input inside a shadow root the way a user would. */
export async function retype(input: HTMLInputElement, text: string): Promise<void> {
  await userEvent.tripleClick(input);
  await userEvent.keyboard('{Backspace}');
  if (text) await userEvent.type(input, text);
}

/** Text content with collapsed whitespace. */
export const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Waits for the widget's controller to report `ready`. */
export function whenReady(host: Element & { activeController?: { state: { value: { availability?: string; status?: string } } } }) {
  return waitFor(
    () => {
      const state = host.activeController?.state.value;
      if (state?.availability !== 'ready' && state?.status !== 'ready') throw new Error(`<${host.localName}> is not ready`);
    },
    { timeout: 4000 },
  );
}
