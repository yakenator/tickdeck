export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/**
 * Typed event emitter. `Events` maps each event name to its payload type.
 *
 * Listeners run in subscription order. A listener that throws does not stop
 * the others; the error is rethrown after every listener has run (an
 * `AggregateError` when several threw).
 */
export class Emitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Adds a listener and returns a function that removes it. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Adds a listener that removes itself after the first event. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const listeners = this.#listeners.get(event);
    if (!listeners || listeners.size === 0) return;
    const errors: unknown[] = [];
    for (const listener of [...listeners] as Listener<Events[K]>[]) {
      try {
        listener(payload);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} listeners failed`);
  }

  /** Number of listeners for one event, or for all events when `event` is omitted. */
  listenerCount(event?: keyof Events): number {
    if (event !== undefined) return this.#listeners.get(event)?.size ?? 0;
    let count = 0;
    for (const listeners of this.#listeners.values()) count += listeners.size;
    return count;
  }

  /** Removes the listeners of one event, or of every event when `event` is omitted. */
  removeAllListeners(event?: keyof Events): void {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }
}
