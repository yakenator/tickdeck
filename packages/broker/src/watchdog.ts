import { systemScheduler, type Scheduler, type TimerHandle } from '@tickdeck/core';
import type { BrokerUpdate } from './contract';

/** Actions that need an acknowledging update from the connector. */
export type BrokerAction = 'submit' | 'amend' | 'cancel' | 'close' | 'reverse' | 'set-exits';

export const DEFAULT_ACK_TIMEOUT_MS = 10_000;

/** Raised when the connector did not confirm an action in time. */
export class AckTimeoutError extends Error {
  override readonly name = 'AckTimeoutError';
  readonly action: BrokerAction;
  /** Order or position the action was about, when known. */
  readonly targetId: string | undefined;
  readonly timeoutMs: number;

  constructor(action: BrokerAction, targetId: string | undefined, timeoutMs: number) {
    super(`No update confirmed ${action}${targetId ? ` of ${targetId}` : ''} within ${timeoutMs} ms`);
    this.action = action;
    this.targetId = targetId;
    this.timeoutMs = timeoutMs;
  }
}

export type AckOutcome = 'acknowledged' | 'timeout' | 'cancelled';

export interface AckExpectation {
  action: BrokerAction;
  /** Order or position id. Can be set later with `PendingAck#setTarget` (submits learn their id late). */
  targetId?: string;
  /** Whether `update` confirms the action. */
  matches(update: BrokerUpdate, targetId: string | undefined): boolean;
}

export interface PendingAck {
  readonly action: BrokerAction;
  readonly targetId: string | undefined;
  /** UTC epoch milliseconds. */
  readonly deadline: number;
  readonly outcome: Promise<AckOutcome>;
  setTarget(targetId: string): void;
  /** Marks the action confirmed, for example from state that arrived before the target was known. */
  acknowledge(): void;
  /** Stops waiting without reporting a timeout (the request itself failed). */
  cancel(): void;
}

export interface AckWatchdogOptions {
  /** Default 10000. */
  timeoutMs?: number;
  scheduler?: Scheduler;
  onTimeout?: (error: AckTimeoutError) => void;
}

/**
 * Tracks actions sent to the connector and the updates that confirm them.
 * Feed every update to `observe`; an action without a matching update before
 * its deadline produces an `AckTimeoutError` through `onTimeout`.
 */
export class AckWatchdog {
  readonly #timeoutMs: number;
  readonly #scheduler: Scheduler;
  readonly #onTimeout: ((error: AckTimeoutError) => void) | undefined;
  readonly #pending = new Set<Entry>();

  constructor(options: AckWatchdogOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#onTimeout = options.onTimeout;
  }

  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /** Actions still waiting for confirmation. */
  get pending(): readonly PendingAck[] {
    return [...this.#pending].map((entry) => entry.handle);
  }

  expect(expectation: AckExpectation, timeoutMs = this.#timeoutMs): PendingAck {
    const entry = new Entry(expectation, this.#scheduler.now() + timeoutMs, (outcome) => {
      this.#pending.delete(entry);
      this.#scheduler.clearTimeout(timer);
      if (outcome === 'timeout') this.#onTimeout?.(new AckTimeoutError(expectation.action, entry.targetId, timeoutMs));
    });
    const timer: TimerHandle = this.#scheduler.setTimeout(() => entry.settle('timeout'), timeoutMs);
    this.#pending.add(entry);
    return entry.handle;
  }

  observe(update: BrokerUpdate): void {
    for (const entry of [...this.#pending]) {
      if (entry.expectation.matches(update, entry.targetId)) entry.settle('acknowledged');
    }
  }

  /** Cancels everything still pending. */
  dispose(): void {
    for (const entry of [...this.#pending]) entry.settle('cancelled');
  }
}

class Entry {
  readonly expectation: AckExpectation;
  readonly handle: PendingAck;
  targetId: string | undefined;
  #settled = false;
  readonly #finish: (outcome: AckOutcome) => void;
  #resolve!: (outcome: AckOutcome) => void;

  constructor(expectation: AckExpectation, deadline: number, finish: (outcome: AckOutcome) => void) {
    this.expectation = expectation;
    this.targetId = expectation.targetId;
    this.#finish = finish;
    const outcome = new Promise<AckOutcome>((resolve) => {
      this.#resolve = resolve;
    });
    const entry = this;
    this.handle = {
      action: expectation.action,
      deadline,
      outcome,
      get targetId() {
        return entry.targetId;
      },
      setTarget: (targetId) => {
        entry.targetId = targetId;
      },
      acknowledge: () => entry.settle('acknowledged'),
      cancel: () => entry.settle('cancelled'),
    };
  }

  settle(outcome: AckOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#finish(outcome);
    this.#resolve(outcome);
  }
}
