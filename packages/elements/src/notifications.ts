import {
  NotificationCenter,
  formatTimeOfDay,
  type NotificationItem,
  type WidgetContext,
} from '@tickdeck/widgets-core';
import { css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { TdkWidgetElement } from './base';
import type { TdkDismissDetail, TdkNotificationDetail } from './events';

export type TdkToastPlacement = 'inline' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

/**
 * Toasts for fills, rejections, broker notices, timeouts and connection
 * changes, announced to screen readers, plus a log of everything shown.
 *
 * @element tdk-notifications
 * @fires tdk-notification - A notification was shown.
 * @fires tdk-dismiss - A toast left the screen.
 */
export class TdkNotificationsElement extends TdkWidgetElement<NotificationCenter> {
  static override properties = {
    ...TdkWidgetElement.properties,
    placement: { reflect: true },
    hideLog: { type: Boolean, attribute: 'hide-log' },
    maxToasts: { type: Number, attribute: 'max-toasts' },
    _logOpen: { state: true },
  };

  static override styles = [
    ...TdkWidgetElement.styles,
    css`
      :host {
        background: transparent;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--_space-2);
        width: 100%;
      }
      :host([placement]:not([placement='inline'])) .stack {
        position: fixed;
        z-index: var(--tdk-z-index-toasts, 1000);
        width: min(360px, calc(100vw - 32px));
      }
      :host([placement='top-start']) .stack,
      :host([placement='top-end']) .stack {
        top: 16px;
      }
      :host([placement='bottom-start']) .stack,
      :host([placement='bottom-end']) .stack {
        bottom: 16px;
        flex-direction: column-reverse;
      }
      :host([placement='top-start']) .stack,
      :host([placement='bottom-start']) .stack {
        left: 16px;
      }
      :host([placement='top-end']) .stack,
      :host([placement='bottom-end']) .stack {
        right: 16px;
      }
      .toast {
        display: flex;
        align-items: flex-start;
        gap: var(--_space-2);
        padding: var(--_space-2) var(--_space-2) var(--_space-2) var(--_space-3);
        border: 1px solid var(--_c-border);
        border-inline-start: 4px solid var(--_level);
        border-radius: var(--_radius);
        background: var(--_c-surface);
        color: var(--_c-text);
      }
      .toast.info {
        --_level: var(--_c-info);
      }
      .toast.success {
        --_level: var(--_c-success);
      }
      .toast.warning {
        --_level: var(--_c-warning);
      }
      .toast.error {
        --_level: var(--_c-error);
      }
      .body {
        flex: 1 1 auto;
        min-width: 0;
      }
      .title {
        margin: 0;
        font-weight: 600;
      }
      .message {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .dismiss {
        appearance: none;
        border: 0;
        background: none;
        color: var(--_c-text-muted);
        font-size: var(--_fs-3);
        line-height: 1;
        padding: 0 var(--_space-1);
        cursor: pointer;
      }
      .log-bar {
        display: flex;
        gap: var(--_space-2);
        margin-top: var(--_space-2);
      }
      ol {
        list-style: none;
        margin: var(--_space-2) 0 0;
        padding: 0;
        max-height: var(--tdk-notifications-log-height, 240px);
        overflow-y: auto;
        border: 1px solid var(--_c-border);
        border-radius: var(--_radius);
        background: var(--_c-surface);
      }
      li {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0 var(--_space-2);
        padding: var(--_space-1) var(--_space-2);
        border-bottom: 1px solid var(--_c-border);
        border-inline-start: 3px solid var(--_level);
      }
      li:last-child {
        border-bottom: 0;
      }
      li.info {
        --_level: var(--_c-info);
      }
      li.success {
        --_level: var(--_c-success);
      }
      li.warning {
        --_level: var(--_c-warning);
      }
      li.error {
        --_level: var(--_c-error);
      }
      li time {
        color: var(--_c-text-muted);
        font-variant-numeric: tabular-nums;
      }
      li .message {
        grid-column: 2;
        color: var(--_c-text-muted);
      }
      .empty {
        padding: var(--_space-2);
        color: var(--_c-text-muted);
      }
    `,
  ];

  /** Where toasts appear: `inline` (default, in the element's place) or fixed to a corner of the viewport. */
  declare placement: TdkToastPlacement | undefined;
  /** Hide the log button and list. */
  declare hideLog: boolean | undefined;
  /** Most toasts on screen at once (for the controller the element creates). */
  declare maxToasts: number | undefined;
  declare _logOpen: boolean;

  #announcement: { text: string; assertive: boolean; serial: number } | undefined;

  constructor() {
    super();
    this._logOpen = false;
  }

  protected override createController(context: WidgetContext): NotificationCenter {
    return new NotificationCenter(context, { maxToasts: this.maxToasts });
  }

  protected override listen(controller: NotificationCenter): (() => void)[] {
    return [
      controller.on('notification', (notification) => {
        const serial = (this.#announcement?.serial ?? 0) + 1;
        const text = `${notification.title}${notification.message ? `. ${notification.message}` : ''}`;
        this.#announcement = { text, assertive: notification.level === 'error', serial };
        this.dispatch<TdkNotificationDetail>('tdk-notification', { notification });
      }),
      controller.on('dismiss', (notification) => this.dispatch<TdkDismissDetail>('tdk-dismiss', { notification })),
    ];
  }

  protected override render(): TemplateResult {
    const center = this.activeController;
    const state = center?.state.value;
    if (!center || !state) return html``;
    const announcement = this.#announcement;
    // A trailing marker that alternates makes repeated identical messages announce again.
    const marker = announcement && announcement.serial % 2 === 0 ? '​' : '';
    return html`
      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" part="live-region">
        ${announcement && !announcement.assertive ? announcement.text + marker : ''}
      </div>
      <div class="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        ${announcement?.assertive ? announcement.text + marker : ''}
      </div>
      <section
        class="stack"
        part="toasts"
        aria-label="Notifications"
        @mouseenter=${() => center.pause()}
        @mouseleave=${() => center.resume()}
        @focusin=${() => center.pause()}
        @focusout=${(event: FocusEvent) => {
          if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) center.resume();
        }}
      >
        ${repeat(
          state.toasts,
          (toast) => toast.id,
          (toast) => this.#toast(toast),
        )}
      </section>
      ${this.hideLog ? nothing : this.#renderLog(state.log)}
    `;
  }

  #toast(toast: NotificationItem): TemplateResult {
    const center = this.activeController as NotificationCenter;
    return html`<div
      class="toast ${toast.level}"
      part="toast toast-${toast.level}"
      data-id=${toast.id}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        center.dismiss(toast.id);
      }}
    >
      <div class="body">
        <p class="title" part="toast-title">${toast.title}</p>
        ${toast.message ? html`<p class="message" part="toast-message">${toast.message}</p>` : nothing}
      </div>
      <button type="button" class="dismiss" part="dismiss-button" aria-label="Dismiss: ${toast.title}" @click=${() => center.dismiss(toast.id)}>
        ×
      </button>
    </div>`;
  }

  #renderLog(log: readonly NotificationItem[]): TemplateResult {
    const center = this.activeController as NotificationCenter;
    const now = Date.now();
    return html`<div class="log-bar">
        <button
          type="button"
          class="btn small"
          part="log-toggle"
          aria-expanded=${this._logOpen ? 'true' : 'false'}
          aria-controls="log"
          @click=${() => (this._logOpen = !this._logOpen)}
        >
          Notifications (${log.length})
        </button>
        ${this._logOpen && log.length > 0
          ? html`<button type="button" class="btn small" part="log-clear" @click=${() => center.clearLog()}>Clear</button>`
          : nothing}
      </div>
      <ol id="log" part="log" aria-label="Notification history" ?hidden=${!this._logOpen}>
        ${log.length === 0 ? html`<li class="empty">No notifications</li>` : nothing}
        ${repeat(
          log,
          (item) => item.id,
          (item) => html`<li class=${item.level} part="log-item">
            <time datetime=${new Date(item.time).toISOString()}>${formatTimeOfDay(item.time, now)}</time>
            <span class="title">${item.title}</span>
            ${item.message ? html`<span class="message">${item.message}</span>` : nothing}
          </li>`,
        )}
      </ol>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tdk-notifications': TdkNotificationsElement;
  }
}
