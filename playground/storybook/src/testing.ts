// Helpers for play functions: the widgets render into open shadow roots,
// which Testing Library queries do not enter.
import { userEvent, waitFor } from 'storybook/test';

type Host = Element & { shadowRoot: ShadowRoot | null };

/** Choices for the `time-zone` controls: the browser's (empty), UTC and two zones on either side of it. */
export const TIME_ZONES = ['', 'UTC', 'Asia/Seoul', 'America/New_York'];

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

/** Every pixel of the canvases in `pane` that passes `test`, with the canvas row from the top in CSS pixels. */
function countPixels(pane: Element, test: (r: number, g: number, b: number, a: number, y: number, height: number) => boolean): number {
  let count = 0;
  for (const canvas of pane.querySelectorAll('canvas')) {
    const context = canvas.getContext('2d');
    if (!context || canvas.width === 0 || canvas.height === 0) continue;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const height = canvas.getBoundingClientRect().height || canvas.height;
    const scale = canvas.height / height;
    for (let index = 0; index < data.length; index += 4) {
      const y = Math.floor(index / 4 / canvas.width) / scale;
      if (test(data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!, y, height)) count += 1;
    }
  }
  return count;
}

/**
 * Pixels of volume bars in a chart pane: the volume colors (`volumeUp`,
 * `volumeDown`, flat and half transparent) on the pane's transparent canvases.
 * Candles are opaque and grid lines grey, so nothing else matches.
 */
export function volumeBarPixels(pane: Element, colors: readonly string[]): number {
  const targets = colors.map(rgbOf);
  return countPixels(
    pane,
    (r, g, b, a) =>
      a >= 96 && a <= 160 && targets.some(([red, green, blue]) => Math.abs(r - red) <= 12 && Math.abs(g - green) <= 12 && Math.abs(b - blue) <= 12),
  );
}

/** The RGB a CSS color resolves to. */
export function rgbOf(color: string): [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

/** Opaque pixels of `color` (±12 per channel) in the band of a pane `band` CSS pixels from its top or bottom edge. */
export function edgePixels(pane: Element, color: string, edge: 'top' | 'bottom', band = 28): number {
  const [red, green, blue] = rgbOf(color);
  return countPixels(
    pane,
    (r, g, b, a, y, height) =>
      a > 200 &&
      Math.abs(r - red) <= 12 &&
      Math.abs(g - green) <= 12 &&
      Math.abs(b - blue) <= 12 &&
      (edge === 'top' ? y < band : y >= height - band),
  );
}
