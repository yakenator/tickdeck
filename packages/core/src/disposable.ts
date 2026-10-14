import type { Unsubscribe } from './emitter';

/** Something that holds resources (subscriptions, timers) until disposed. */
export interface Disposable {
  dispose(): void;
}

export function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === 'function'
  );
}

/** Wraps a cleanup function. Calling `dispose` more than once runs it once. */
export function toDisposable(cleanup: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      cleanup();
    },
  };
}

/**
 * Collects disposables and unsubscribe functions and releases them together,
 * newest first. Anything added after disposal is released immediately.
 */
export class DisposableGroup implements Disposable {
  readonly #items: Disposable[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  add<T extends Disposable | Unsubscribe>(item: T): T {
    const entry: Disposable | Unsubscribe = item;
    const disposable = typeof entry === 'function' ? toDisposable(entry) : entry;
    if (this.#disposed) disposable.dispose();
    else this.#items.push(disposable);
    return item;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const item of this.#items.splice(0).reverse()) {
      try {
        item.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} disposables failed`);
  }
}
