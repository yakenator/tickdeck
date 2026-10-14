import {
  DisposableGroup,
  Emitter,
  ObservableValue,
  systemScheduler,
  type Disposable,
  type Listener,
  type ReadonlyObservableValue,
  type Scheduler,
  type SubscribeOptions,
  type Unsubscribe,
  type ValueListener,
} from '@tickdeck/core';
import type { BrokerSession } from '@tickdeck/broker';
import type { WidgetContext } from './context';

/**
 * Base of every widget controller: an observable, immutable `state` that a
 * view renders, action methods that change it, and typed events for things
 * the view or the application must react to.
 *
 * State objects are replaced, never mutated, so `state.value !== previous`
 * whenever something changed.
 */
export abstract class WidgetController<State extends object, Events extends object = object> implements Disposable {
  readonly context: WidgetContext;
  readonly state: ReadonlyObservableValue<State>;
  protected readonly disposables = new DisposableGroup();
  protected readonly scheduler: Scheduler;
  readonly #state: ObservableValue<State>;
  readonly #events = new Emitter<Events>();

  constructor(context: WidgetContext, initial: State) {
    this.context = context;
    this.scheduler = context.scheduler ?? systemScheduler;
    this.#state = new ObservableValue(initial);
    this.state = this.#state.asReadonly();
  }

  get session(): BrokerSession {
    return this.context.session;
  }

  get disposed(): boolean {
    return this.disposables.disposed;
  }

  /** Shorthand for `state.subscribe`. */
  subscribe(listener: ValueListener<State>, options?: SubscribeOptions): Unsubscribe {
    return this.#state.subscribe(listener, options);
  }

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    return this.#events.once(event, listener);
  }

  /** Releases subscriptions and timers. The controller stops updating. */
  dispose(): void {
    this.disposables.dispose();
    this.#events.removeAllListeners();
  }

  protected setState(patch: Partial<State>): void {
    if (this.disposed) return;
    this.#state.set({ ...this.#state.value, ...patch });
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    if (!this.disposed) this.#events.emit(event, payload);
  }
}
