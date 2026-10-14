import { isValidTimeZone, type WidgetContext, type WidgetFeed } from '@tickdeck/widgets-core';
import { LitElement, type PropertyValues } from 'lit';
import { baseStyles, themeStyles } from './styles';

export type TdkTheme = 'light' | 'dark' | 'auto';

/** What the base element needs from a controller. */
export interface ElementController {
  readonly state: { subscribe(listener: () => void): () => void };
  /** Switches the time zone of displayed times. Called on controllers the element created. */
  setTimeZone?(timeZone: string | undefined): void;
  dispose(): void;
}

/**
 * Base of the `tdk-*` widgets. A widget renders a controller from
 * `@tickdeck/widgets-core`: pass one as `controller`, or pass `session` (and
 * `feed`, `scheduler`, `timeZone`) and the element creates and owns one,
 * disposing it when removed.
 */
export abstract class TdkWidgetElement<C extends ElementController> extends LitElement {
  static override properties = {
    controller: { attribute: false },
    session: { attribute: false },
    feed: { attribute: false },
    scheduler: { attribute: false },
    timeZone: { attribute: 'time-zone' },
    theme: { reflect: true },
  };

  static override styles = [themeStyles, baseStyles];

  /** A controller to render. Takes precedence over `session`. */
  declare controller: C | undefined;
  /** The trading session. The element creates its own controller from it. */
  declare session: WidgetContext['session'] | undefined;
  /** Quotes and instrument metadata, typically a `MarketFeed`. */
  declare feed: WidgetFeed | undefined;
  /** Clock and timers for the controller the element creates. Default: the host's. */
  declare scheduler: WidgetContext['scheduler'];
  /**
   * IANA time zone of displayed times, such as `America/New_York` (attribute
   * `time-zone`). Default: the browser's. Applies to the controller the element
   * creates; a `controller` you pass keeps the time zone of its own context.
   */
  declare timeZone: string | undefined;
  /** `light` (default), `dark` or `auto` (follows the system). Tokens set by the page take precedence. */
  declare theme: TdkTheme | undefined;

  #owned: C | undefined;
  #ownedFor: Pick<WidgetContext, 'session' | 'feed' | 'scheduler'> | undefined;
  #invalidTimeZone: string | undefined;
  #active: C | undefined;
  #release: (() => void)[] = [];

  /** The controller being rendered: `controller`, or the one created from `session`. */
  get activeController(): C | undefined {
    return this.#active;
  }

  protected abstract createController(context: WidgetContext): C;

  /** Subscribes to controller events that the element turns into DOM events. Returns the unsubscribers. */
  protected listen(_controller: C): (() => void)[] {
    return [];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#attach();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detach();
    // Elements moved within the page are disconnected and connected again in one task.
    queueMicrotask(() => {
      if (!this.isConnected) this.#disposeOwned();
    });
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('controller') || changed.has('session') || changed.has('feed') || changed.has('scheduler')) this.#attach();
    if (changed.has('timeZone')) this.#owned?.setTimeZone?.(this.#timeZone());
  }

  /** Dispatches a bubbling, composed `CustomEvent`. Returns false when a listener called `preventDefault`. */
  protected dispatch<D>(type: string, detail: D, cancelable = false): boolean {
    return this.dispatchEvent(new CustomEvent<D>(type, { detail, bubbles: true, composed: true, cancelable }));
  }

  #attach(): void {
    if (!this.isConnected) return;
    let target = this.controller;
    if (target) {
      this.#disposeOwned();
    } else if (this.session) {
      const owned = this.#ownedFor;
      if (!this.#owned || owned?.session !== this.session || owned.feed !== this.feed || owned.scheduler !== this.scheduler) {
        this.#disposeOwned();
        const context = { session: this.session, feed: this.feed, scheduler: this.scheduler };
        this.#owned = this.createController({ ...context, timeZone: this.#timeZone() });
        this.#ownedFor = context;
      }
      target = this.#owned;
    } else {
      this.#disposeOwned();
    }
    if (target === this.#active) return;
    this.#detach();
    this.#active = target;
    if (target) {
      this.#release = [target.state.subscribe(() => this.requestUpdate()), ...this.listen(target)];
    }
    this.requestUpdate();
  }

  /** `timeZone` when the host knows it; otherwise the browser's, with a warning. */
  #timeZone(): string | undefined {
    const timeZone = this.timeZone || undefined;
    if (timeZone === undefined || isValidTimeZone(timeZone)) return timeZone;
    if (this.#invalidTimeZone !== timeZone) {
      this.#invalidTimeZone = timeZone;
      console.warn(`<${this.localName}>: unknown time zone "${timeZone}"; showing times in the browser's time zone`);
    }
    return undefined;
  }

  #detach(): void {
    for (const release of this.#release.splice(0)) release();
    this.#active = undefined;
  }

  #disposeOwned(): void {
    const owned = this.#owned;
    if (!owned) return;
    if (this.#active === owned) this.#detach();
    this.#owned = undefined;
    this.#ownedFor = undefined;
    owned.dispose();
  }
}
