// Test helpers for running the chart engine under happy-dom, which has no canvas or layout.
import type { Scheduler } from '@tickdeck/core';

export const WIDTH = 800;
export const HEIGHT = 500;

function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    measureText: (text: string) => ({ width: text.length * 6 }),
    createLinearGradient: () => {
      throw new Error('Gradients are not allowed');
    },
    createRadialGradient: () => {
      throw new Error('Gradients are not allowed');
    },
    getImageData: () => ({ data: [] }),
  };
  return new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : typeof key === 'string' ? () => undefined : undefined),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let installed = false;

/** Gives every element a fixed size and every canvas a do-nothing 2D context that refuses gradients. */
export function installFakeLayout(): void {
  if (installed) return;
  installed = true;
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return fakeContext();
  } as unknown as HTMLCanvasElement['getContext'];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => WIDTH });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HEIGHT });
}

export function createContainer(): HTMLElement {
  installFakeLayout();
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

/** A clock that only moves when told to. Timers run when `advance` passes them. */
export class ManualClock implements Scheduler {
  time: number;
  #timers = new Map<number, { at: number; callback: () => void }>();
  #next = 1;

  constructor(time: number) {
    this.time = time;
  }

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.#next++;
    this.#timers.set(id, { at: this.time + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number);
  }

  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.#timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].at);
      due[1].callback();
    }
    this.time = end;
  }
}

/** Lets pending promise callbacks and microtasks run. */
export async function flush(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

/** Waits for macrotasks too (timers of 0 ms, engine layout). */
export function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
