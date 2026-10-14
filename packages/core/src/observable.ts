import type { Unsubscribe } from './emitter';

export type ValueListener<T> = (value: T, previous: T) => void;

export interface SubscribeOptions {
  /** Call the listener right away with the current value (`previous` equals `value`). */
  emitCurrent?: boolean;
}

/** Read side of an {@link ObservableValue}. */
export interface ReadonlyObservableValue<T> {
  readonly value: T;
  subscribe(listener: ValueListener<T>, options?: SubscribeOptions): Unsubscribe;
}

export interface ObservableValueOptions<T> {
  /** Decides whether a new value counts as a change. Defaults to `Object.is`. */
  equals?: (a: T, b: T) => boolean;
}

/**
 * A single value that notifies subscribers when it changes. Used for state
 * such as connection status or account balance that widgets render directly.
 */
export class ObservableValue<T> implements ReadonlyObservableValue<T> {
  #value: T;
  readonly #equals: (a: T, b: T) => boolean;
  readonly #listeners = new Set<ValueListener<T>>();

  constructor(initial: T, options: ObservableValueOptions<T> = {}) {
    this.#value = initial;
    this.#equals = options.equals ?? Object.is;
  }

  get value(): T {
    return this.#value;
  }

  /** Replaces the value. Subscribers are notified only when it changed. */
  set(next: T): void {
    const previous = this.#value;
    if (this.#equals(previous, next)) return;
    this.#value = next;
    const errors: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener(next, previous);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} listeners failed`);
  }

  update(change: (current: T) => T): void {
    this.set(change(this.#value));
  }

  subscribe(listener: ValueListener<T>, options: SubscribeOptions = {}): Unsubscribe {
    this.#listeners.add(listener);
    if (options.emitCurrent) listener(this.#value, this.#value);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** A view that can be read and subscribed to but not changed. */
  asReadonly(): ReadonlyObservableValue<T> {
    const source = this;
    return {
      get value() {
        return source.value;
      },
      subscribe: (listener, options) => source.subscribe(listener, options),
    };
  }
}
