export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class Emitter<Events extends object> {
  readonly #listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const listeners = (this.#listeners[event] ??= new Set());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.#listeners[event]?.forEach((listener) => listener(payload));
  }
}
