import {
  TradeButtonsController,
  type TradeButtonsState,
  type TradeSideView,
  type WidgetContext,
} from '@tickdeck/widgets-core';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { TdkWidgetElement } from './base';
import { NumberDrafts } from './controls';
import type { TdkOrderErrorDetail, TdkOrderPlacedDetail } from './events';

/**
 * Sell and buy buttons with live bid, ask and spread, sending market orders
 * in one click (or two, in confirm mode).
 *
 * @element tdk-trade-buttons
 * @fires tdk-order-placed - An order was sent and confirmed.
 * @fires tdk-order-error - Sending an order failed.
 */
export class TdkTradeButtonsElement extends TdkWidgetElement<TradeButtonsController> {
  static override properties = {
    ...TdkWidgetElement.properties,
    instrument: {},
    quantity: { type: Number },
    confirm: { type: Boolean, reflect: true },
  };

  static override styles = [
    ...TdkWidgetElement.styles,
    css`
      .container {
        display: flex;
        flex-direction: column;
        gap: var(--_space-2);
        padding: var(--_space-2);
        border: 1px solid var(--_c-border);
        border-radius: var(--_radius);
        background: var(--_c-surface);
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--_space-2);
      }
      .instrument {
        font-weight: 600;
      }
      .buttons {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: var(--_space-1);
        align-items: stretch;
      }
      .side {
        flex-direction: column;
        min-height: 52px;
        gap: 0;
      }
      .side .label {
        font-size: var(--_fs-1);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .side .price {
        font-size: var(--_fs-3);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .spread {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 3.5em;
        font-size: var(--_fs-1);
        font-variant-numeric: tabular-nums;
        color: var(--_c-text-muted);
      }
      .quantity {
        display: flex;
        align-items: center;
        gap: var(--_space-1);
      }
      .quantity label {
        font-size: var(--_fs-1);
        color: var(--_c-text-muted);
      }
      .quantity .field {
        flex: 1 1 auto;
        min-width: 4em;
      }
      .quantity .btn {
        min-width: var(--_control-height);
        padding: 0;
      }
      .confirm {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_space-2);
        padding: var(--_space-2);
        border: 1px solid var(--_c-accent);
        border-radius: var(--_radius);
      }
      .confirm span {
        flex: 1 1 100%;
      }
      .reason,
      .result {
        margin: 0;
        font-size: var(--_fs-1);
      }
      .reason {
        color: var(--_c-text-muted);
      }
      .result:empty {
        display: none;
      }
      .result.success {
        color: var(--_c-success);
      }
      .result.error {
        color: var(--_c-error);
      }
    `,
  ];

  /** Instrument id. */
  declare instrument: string | undefined;
  /** Default quantity. */
  declare quantity: number | undefined;
  /** Ask for confirmation before each order. */
  declare confirm: boolean | undefined;

  readonly #drafts = new NumberDrafts();
  #armedShown: string | undefined;

  protected override createController(context: WidgetContext): TradeButtonsController {
    return new TradeButtonsController(context, { instrument: this.instrument, quantity: this.quantity, confirm: this.confirm });
  }

  protected override listen(controller: TradeButtonsController): (() => void)[] {
    return [
      controller.on('placed', (detail) => this.dispatch<TdkOrderPlacedDetail>('tdk-order-placed', detail)),
      controller.on('error', ({ error, message }) =>
        this.dispatch<TdkOrderErrorDetail>('tdk-order-error', { action: 'trade', error, message }),
      ),
    ];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    const controller = this.activeController;
    if (!controller) return;
    if (changed.has('instrument') && this.instrument !== undefined) void controller.setInstrument(this.instrument);
    if (changed.has('confirm') && this.confirm !== undefined) controller.setConfirm(this.confirm);
  }

  protected override updated(): void {
    const armed = this.activeController?.state.value.armed;
    if (armed && armed !== this.#armedShown) this.renderRoot.querySelector<HTMLElement>('[part~="confirm-button"]')?.focus();
    this.#armedShown = armed;
  }

  protected override render(): TemplateResult {
    const controller = this.activeController;
    const state = controller?.state.value;
    if (!controller || !state) {
      return html`<div class="container" part="container"><p class="reason" part="reason">No trading session</p></div>`;
    }
    const name = state.instrument?.name ?? state.instrumentId ?? '';
    const reason = state.reason ?? state.quantityError;
    return html`<div class="container" part="container" role="group" aria-label="Trade ${name}">
      <div class="head">
        <span class="instrument" part="instrument">${name}</span>
        ${state.confirm ? html`<span class="muted" part="mode">Confirm on</span>` : nothing}
      </div>
      <div class="buttons">
        ${this.#sideButton(state, state.sell)}
        <div class="spread" part="spread" aria-label="Spread ${state.quote?.spreadText ?? 'unknown'}">
          <span aria-hidden="true">Spread</span><span aria-hidden="true">${state.quote?.spreadText || '–'}</span>
        </div>
        ${this.#sideButton(state, state.buy)}
      </div>
      ${state.armed ? this.#renderConfirm(state) : nothing}
      <div class="quantity" part="quantity">
        <label for="quantity">Qty</label>
        <button type="button" class="btn" part="step-button" aria-label="Decrease quantity" @click=${() => controller.stepQuantity(-1)}>
          −
        </button>
        <input
          id="quantity"
          class="field num"
          part="input quantity-input"
          inputmode="decimal"
          autocomplete="off"
          aria-invalid=${state.quantityError ? 'true' : 'false'}
          aria-describedby=${reason ? 'reason' : nothing}
          .value=${live(this.#drafts.text('quantity', state.quantity, state.instrument?.quantityPrecision ?? 0))}
          @input=${(event: Event) => controller.setQuantity(this.#drafts.type('quantity', (event.target as HTMLInputElement).value))}
          @change=${() => {
            this.#drafts.release('quantity');
            this.requestUpdate();
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            controller.stepQuantity(event.key === 'ArrowUp' ? 1 : -1);
          }}
        />
        <button type="button" class="btn" part="step-button" aria-label="Increase quantity" @click=${() => controller.stepQuantity(1)}>
          +
        </button>
      </div>
      <p id="reason" class="reason" part="reason" ?hidden=${!reason}>${reason ?? ''}</p>
      <p class="result ${state.result?.level ?? ''}" part="result" role="status" aria-live="polite">${state.result?.message ?? ''}</p>
    </div>`;
  }

  #sideButton(state: TradeButtonsState, view: TradeSideView): TemplateResult {
    const busy = state.busy === view.side;
    return html`<button
      type="button"
      class="btn side ${view.side}"
      part="${view.side}-button"
      ?disabled=${!view.enabled}
      aria-busy=${busy ? 'true' : 'false'}
      aria-pressed=${state.confirm ? (state.armed === view.side ? 'true' : 'false') : nothing}
      aria-label="${view.description}${view.priceText ? `, ${view.side === 'buy' ? 'ask' : 'bid'} ${view.priceText}` : ''}"
      title=${view.reason ?? nothing}
      @click=${() => void this.activeController?.trade(view.side)}
    >
      <span class="label">${busy ? 'Sending…' : view.label}</span>
      <span class="price">${view.priceText || '–'}</span>
    </button>`;
  }

  #renderConfirm(state: TradeButtonsState): TemplateResult {
    const controller = this.activeController as TradeButtonsController;
    const view = state.armed === 'buy' ? state.buy : state.sell;
    return html`<div
      class="confirm"
      part="confirm"
      role="group"
      aria-label="Confirm order"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        controller.cancelTrade();
        void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`[part~="${view.side}-button"]`)?.focus());
      }}
    >
      <span>${view.description}?</span>
      <button type="button" class="btn small ${view.side}" part="confirm-button" @click=${() => void controller.confirmTrade()}>
        Confirm
      </button>
      <button type="button" class="btn small" part="cancel-button" @click=${() => controller.cancelTrade()}>Cancel</button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tdk-trade-buttons': TdkTradeButtonsElement;
  }
}
