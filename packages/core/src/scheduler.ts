/** Opaque handle returned by {@link Scheduler.setTimeout}. */
export type TimerHandle = unknown;

/**
 * Clock and timers. Everything time-based in tickdeck takes one, so tests and
 * simulations can substitute their own.
 */
export interface Scheduler {
  /** Current time in UTC epoch milliseconds. */
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

interface HostTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

// Looked up on every call so that fake timers installed later (tests) are honoured.
const host = (): HostTimers => globalThis as unknown as HostTimers;

/** The host environment's clock and timers (`Date.now`, `setTimeout`). */
export const systemScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => host().setTimeout(callback, delayMs),
  clearTimeout: (handle) => host().clearTimeout(handle),
};

/** Runs `callback` in a microtask, after the current synchronous code finishes. */
export function microtask(callback: () => void): void {
  void Promise.resolve().then(callback);
}
