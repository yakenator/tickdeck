import {
  ORDER_KIND_LABELS,
  OrderTicketController,
  SIDE_LABELS,
  TIME_IN_FORCE_DESCRIPTIONS,
  TIME_IN_FORCE_LABELS,
  formatAmount,
  type EstimateItem,
  type ExitField,
  type ExitInputMode,
  type OrderTicketState,
  type TicketField,
  type WidgetContext,
} from '@tickdeck/widgets-core';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { TdkWidgetElement } from './base';
import { NumberDrafts, segmented, type Choice } from './controls';
import type { TdkOrderAmendedDetail, TdkOrderErrorDetail, TdkOrderPlacedDetail } from './events';

type Side = OrderTicketState['side'];
type OrderKind = OrderTicketState['kind'];
type BrokerOrder = NonNullable<OrderTicketState['amendOrder']>;

/** An instrument offered in the ticket's instrument picker. */
export type TicketInstrumentChoice = string | { id: string; name?: string };

const EXIT_FIELDS: readonly ExitField[] = ['takeProfit', 'stopLoss'];
const EXIT_LABELS: Record<ExitField, string> = { takeProfit: 'Take-profit', stopLoss: 'Stop-loss' };
const EXIT_MODES: readonly Choice<ExitInputMode>[] = [
  { value: 'price', label: 'Price' },
  { value: 'ticks', label: 'Ticks' },
];

const pad = (value: number) => String(value).padStart(2, '0');

/** `datetime-local` value in the browser's timezone. */
function toLocalInput(time: number | undefined): string {
  if (time === undefined || !Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Order entry with live bid and ask, validation, protective exits, estimates
 * and an optional review step. Also edits working orders (amend mode).
 *
 * @element tdk-order-ticket
 * @fires tdk-order-placed - An order was sent and confirmed.
 * @fires tdk-order-amended - A working order was changed.
 * @fires tdk-order-error - Checking, sending or changing failed.
 */
export class TdkOrderTicketElement extends TdkWidgetElement<OrderTicketController> {
  static override properties = {
    ...TdkWidgetElement.properties,
    instrument: {},
    side: {},
    kind: {},
    quantity: { type: Number },
    checkOrders: { type: Boolean, attribute: 'check-orders' },
    exitMode: { attribute: 'exit-mode' },
    instruments: { attribute: false },
  };

  static override styles = [
    ...TdkWidgetElement.styles,
    css`
      form {
        display: flex;
        flex-direction: column;
        gap: var(--_space-2);
        padding: var(--_space-3);
        border: 1px solid var(--_c-border);
        border-radius: var(--_radius);
        background: var(--_c-surface);
        min-width: 0;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-2);
      }
      .title {
        font-size: var(--_fs-3);
        font-weight: 600;
      }
      .badge {
        padding: 0 var(--_space-2);
        border-radius: var(--_radius);
        background: var(--_c-surface-2);
        font-size: var(--_fs-1);
      }
      .quote {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: var(--_space-1);
        align-items: stretch;
      }
      .quote button {
        appearance: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--_space-1);
        border: 1px solid var(--_c-border);
        border-radius: var(--_radius);
        background: var(--_c-surface-2);
        cursor: pointer;
      }
      .quote button:disabled {
        cursor: default;
      }
      .quote .label,
      .spread .label {
        font-size: var(--_fs-1);
        color: var(--_c-text-muted);
      }
      .quote .price {
        font-size: var(--_fs-3);
        font-variant-numeric: tabular-nums;
      }
      .spread {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-variant-numeric: tabular-nums;
      }
      .segmented {
        display: flex;
      }
      .segmented > button.buy[aria-checked='true'] {
        background: var(--_c-buy);
        color: var(--_c-on-buy);
      }
      .segmented > button.sell[aria-checked='true'] {
        background: var(--_c-sell);
        color: var(--_c-on-sell);
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .row > label,
      .row-label {
        font-size: var(--_fs-1);
        color: var(--_c-text-muted);
      }
      .stepper {
        display: flex;
        gap: var(--_space-1);
      }
      .stepper .btn {
        min-width: var(--_control-height);
        padding: 0;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--_space-2);
      }
      fieldset {
        margin: 0;
        padding: var(--_space-2);
        border: 1px solid var(--_c-border);
        border-radius: var(--_radius);
        display: flex;
        flex-direction: column;
        gap: var(--_space-2);
      }
      legend {
        padding: 0 var(--_space-1);
        font-size: var(--_fs-1);
        color: var(--_c-text-muted);
      }
      .exit-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-2);
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: var(--_space-1);
      }
      .hint {
        font-size: var(--_fs-1);
      }
      dl {
        display: grid;
        grid-template-columns: auto auto;
        gap: 2px var(--_space-2);
        margin: 0;
      }
      dt {
        color: var(--_c-text-muted);
      }
      dd {
        margin: 0;
        text-align: end;
        font-variant-numeric: tabular-nums;
      }
      ul {
        margin: 0;
        padding-inline-start: 1.2em;
        color: var(--_c-warning);
      }
      .review {
        display: flex;
        flex-direction: column;
        gap: var(--_space-2);
        padding: var(--_space-2);
        border: 1px solid var(--_c-accent);
        border-radius: var(--_radius);
      }
      .actions {
        display: flex;
        gap: var(--_space-2);
      }
      .actions .btn {
        flex: 1 1 auto;
      }
      .submit {
        min-height: calc(var(--_control-height) + 6px);
        font-weight: 600;
      }
      .notice {
        margin: 0;
        padding: var(--_space-2);
        border-radius: var(--_radius);
        background: var(--_c-surface-2);
        color: var(--_c-text-muted);
      }
      .result:empty {
        display: none;
      }
      .result {
        margin: 0;
      }
      .result.success {
        color: var(--_c-success);
      }
      .result.info {
        color: var(--_c-info);
      }
      .result.error {
        color: var(--_c-error);
      }
    `,
  ];

  /** Instrument id. */
  declare instrument: string | undefined;
  /** Initial side: `buy` or `sell`. */
  declare side: Side | undefined;
  /** Initial order kind: `market`, `limit`, `stop` or `stop-limit`. */
  declare kind: OrderKind | undefined;
  /** Default quantity. */
  declare quantity: number | undefined;
  /** Check orders with the broker and ask for confirmation. Default: the broker's capability. */
  declare checkOrders: boolean | undefined;
  /** How exits are entered at first: `price` or `ticks`. */
  declare exitMode: ExitInputMode | undefined;
  /** Instruments offered in a picker. Without it the instrument is fixed. */
  declare instruments: readonly TicketInstrumentChoice[] | undefined;

  readonly #drafts = new NumberDrafts();
  #reviewShown = false;

  /** Opens a working order for editing. */
  amend(order: BrokerOrder): Promise<void> {
    return this.activeController?.amend(order) ?? Promise.resolve();
  }

  /** Same as pressing the submit button. */
  submit(): Promise<boolean> {
    return this.activeController?.submit() ?? Promise.resolve(false);
  }

  reset(): void {
    this.activeController?.reset();
  }

  protected override createController(context: WidgetContext): OrderTicketController {
    return new OrderTicketController(context, {
      instrument: this.instrument,
      side: this.side,
      kind: this.kind,
      quantity: this.quantity,
      checkOrders: this.hasAttribute('check-orders') || this.checkOrders ? true : undefined,
      exitMode: this.exitMode,
    });
  }

  protected override listen(controller: OrderTicketController): (() => void)[] {
    return [
      controller.on('placed', (detail) => this.dispatch<TdkOrderPlacedDetail>('tdk-order-placed', detail)),
      controller.on('amended', (detail) => this.dispatch<TdkOrderAmendedDetail>('tdk-order-amended', detail)),
      controller.on('error', (detail) => this.dispatch<TdkOrderErrorDetail>('tdk-order-error', detail)),
    ];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    const controller = this.activeController;
    if (!controller) return;
    if (changed.has('instrument') && this.instrument !== undefined) void controller.setInstrument(this.instrument);
    if (changed.has('side') && this.side) controller.setSide(this.side);
    if (changed.has('kind') && this.kind) controller.setKind(this.kind);
  }

  protected override updated(): void {
    const review = this.activeController?.state.value.phase === 'review';
    if (review && !this.#reviewShown) this.renderRoot.querySelector<HTMLElement>('[part~="confirm-button"]')?.focus();
    this.#reviewShown = review;
  }

  protected override render(): TemplateResult {
    const controller = this.activeController;
    const state = controller?.state.value;
    if (!controller || !state) {
      return html`<form part="form" aria-label="Order ticket"><p class="notice" part="status">No trading session</p></form>`;
    }
    const usable = state.availability === 'ready';
    const instrument = state.instrument;
    const name = instrument?.name ?? state.instrumentId ?? '';
    return html`<form part="form" aria-label="Order ticket${name ? `: ${name}` : ''}" novalidate @submit=${this.#onSubmit}>
      <header part="header">
        ${this.#renderInstrument(state, name)}
        ${state.mode === 'amend'
          ? html`<span class="badge" part="mode">Changing ${state.amendOrder?.id}</span>`
          : nothing}
      </header>
      ${state.availability !== 'ready' && state.reason
        ? html`<p class="notice" part="status" role="status">${state.reason}</p>`
        : nothing}
      ${instrument ? this.#renderBody(state, usable) : nothing}
      <p class="result ${state.result?.level ?? ''}" part="result" role="status" aria-live="polite">${state.result?.message ?? ''}</p>
    </form>`;
  }

  #renderInstrument(state: OrderTicketState, name: string): TemplateResult {
    const choices = this.instruments;
    if (!choices || choices.length === 0) return html`<span class="title" part="instrument">${name}</span>`;
    return html`<label class="visually-hidden" for="instrument">Instrument</label>
      <select
        id="instrument"
        class="field title"
        part="select instrument-select"
        ?disabled=${!state.editable.instrument}
        @change=${(event: Event) => void this.activeController?.setInstrument((event.target as HTMLSelectElement).value)}
      >
        ${state.instrumentId && !choices.some((choice) => (typeof choice === 'string' ? choice : choice.id) === state.instrumentId)
          ? html`<option value=${state.instrumentId} selected>${name}</option>`
          : nothing}
        ${choices.map((choice) => {
          const id = typeof choice === 'string' ? choice : choice.id;
          const label = typeof choice === 'string' ? (id === state.instrumentId ? name : id) : (choice.name ?? id);
          return html`<option value=${id} ?selected=${id === state.instrumentId}>${label}</option>`;
        })}
      </select>`;
  }

  #renderBody(state: OrderTicketState, usable: boolean): TemplateResult {
    const controller = this.activeController as OrderTicketController;
    const instrument = state.instrument!;
    const busy = state.busy;
    const quote = state.quote;
    const sideChoices: Choice<Side>[] = [
      { value: 'buy', label: SIDE_LABELS.buy, className: 'buy' },
      { value: 'sell', label: SIDE_LABELS.sell, className: 'sell' },
    ];
    const kindChoices: Choice<OrderKind>[] = state.orderKinds.map((kind) => ({ value: kind, label: ORDER_KIND_LABELS[kind] }));
    const priceDecimals = instrument.pricePrecision;
    return html`
      <div class="quote" part="quote">
        <button
          type="button"
          part="bid"
          aria-label="Bid ${quote?.bidText ?? 'unknown'}${state.kind === 'market' ? '' : ', use as price'}"
          ?disabled=${busy || state.kind === 'market' || quote?.bid === undefined}
          @click=${() => quote?.bid !== undefined && controller.usePrice(quote.bid)}
        >
          <span class="label">Bid</span><span class="price">${quote?.bidText || '–'}</span>
        </button>
        <div class="spread" part="spread"><span class="label">Spread</span><span>${quote?.spreadText || '–'}</span></div>
        <button
          type="button"
          part="ask"
          aria-label="Ask ${quote?.askText ?? 'unknown'}${state.kind === 'market' ? '' : ', use as price'}"
          ?disabled=${busy || state.kind === 'market' || quote?.ask === undefined}
          @click=${() => quote?.ask !== undefined && controller.usePrice(quote.ask)}
        >
          <span class="label">Ask</span><span class="price">${quote?.askText || '–'}</span>
        </button>
      </div>
      ${segmented({
        label: 'Side',
        choices: sideChoices,
        selected: state.side,
        disabled: !state.editable.side,
        part: 'side',
        onSelect: (side) => controller.setSide(side),
      })}
      ${segmented({
        label: 'Order type',
        choices: kindChoices,
        selected: state.kind,
        disabled: !state.editable.kind,
        part: 'kind',
        onSelect: (kind) => controller.setKind(kind),
      })}
      <div class="row" part="field quantity-field">
        <label for="quantity">Quantity</label>
        <div class="stepper">
          <button
            type="button"
            class="btn"
            part="step-button"
            aria-label="Decrease quantity"
            ?disabled=${!state.editable.quantity}
            @click=${() => controller.stepQuantity(-1)}
          >
            −
          </button>
          ${this.#numberInput(state, 'quantity', state.quantity, instrument.quantityPrecision, (value) => controller.setQuantity(value), {
            part: 'quantity-input',
            disabled: !state.editable.quantity,
            onStep: (steps) => controller.stepQuantity(steps),
          })}
          <button
            type="button"
            class="btn"
            part="step-button"
            aria-label="Increase quantity"
            ?disabled=${!state.editable.quantity}
            @click=${() => controller.stepQuantity(1)}
          >
            +
          </button>
        </div>
        ${this.#error(state, 'quantity')}
      </div>
      ${state.needsStopPrice ? this.#priceRow(state, 'stopPrice', 'Stop price', state.stopPrice, priceDecimals) : nothing}
      ${state.needsLimitPrice ? this.#priceRow(state, 'limitPrice', 'Limit price', state.limitPrice, priceDecimals) : nothing}
      ${state.timeInForceOptions.length > 0 ? this.#renderTimeInForce(state) : nothing}
      ${state.exitsAllowed ? this.#renderExits(state, priceDecimals) : nothing}
      ${state.estimates.length > 0 ? this.#estimates(state.estimates, 'estimates', 'Estimates') : nothing}
      ${state.warnings.length > 0
        ? html`<ul part="warnings">
            ${state.warnings.map((warning) => html`<li>${warning}</li>`)}
          </ul>`
        : nothing}
      ${state.phase === 'review' && state.review ? this.#renderReview(state) : this.#renderSubmit(state, usable)}
    `;
  }

  #numberInput(
    state: OrderTicketState,
    field: string,
    value: number | undefined,
    decimals: number,
    onValue: (value: number | undefined) => void,
    options: { part: string; disabled?: boolean; onStep?: (steps: number) => void; label?: string; errorField?: TicketField },
  ): TemplateResult {
    const error = state.visibleErrors[options.errorField ?? (field as TicketField)];
    return html`<input
      id=${field}
      class="field num"
      part="input ${options.part}"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      aria-label=${options.label ?? nothing}
      aria-invalid=${error ? 'true' : 'false'}
      aria-describedby=${error ? `${field}-error` : nothing}
      .value=${live(this.#drafts.text(field, value, decimals))}
      ?disabled=${options.disabled}
      @input=${(event: Event) => onValue(this.#drafts.type(field, (event.target as HTMLInputElement).value))}
      @change=${() => {
        this.#drafts.release(field);
        this.requestUpdate();
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (!options.onStep || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        options.onStep(event.key === 'ArrowUp' ? 1 : -1);
      }}
    />`;
  }

  #error(state: OrderTicketState, field: TicketField, id: string = field): TemplateResult | typeof nothing {
    const error = state.visibleErrors[field];
    return error ? html`<span id="${id}-error" class="error-text" part="error">${error}</span>` : nothing;
  }

  #priceRow(
    state: OrderTicketState,
    field: 'limitPrice' | 'stopPrice',
    label: string,
    value: number | undefined,
    decimals: number,
  ): TemplateResult {
    const controller = this.activeController as OrderTicketController;
    return html`<div class="row" part="field ${field === 'limitPrice' ? 'limit' : 'stop'}-field">
      <label for=${field}>${label}</label>
      ${this.#numberInput(state, field, value, decimals, (price) => (field === 'limitPrice' ? controller.setLimitPrice(price) : controller.setStopPrice(price)), {
        part: field === 'limitPrice' ? 'limit-price-input' : 'stop-price-input',
        disabled: state.busy,
        onStep: (steps) => controller.stepPrice(field, steps),
      })}
      ${this.#error(state, field)}
    </div>`;
  }

  #renderTimeInForce(state: OrderTicketState): TemplateResult {
    const controller = this.activeController as OrderTicketController;
    const gtd = state.timeInForce === 'gtd';
    return html`<div class=${gtd ? 'pair' : ''}>
      <div class="row" part="field tif-field">
        <label for="tif">Time in force</label>
        <select
          id="tif"
          class="field"
          part="select tif-select"
          ?disabled=${!state.editable.timeInForce}
          @change=${(event: Event) =>
            controller.setTimeInForce((event.target as HTMLSelectElement).value as NonNullable<OrderTicketState['timeInForce']>)}
        >
          ${state.timeInForceOptions.map(
            (tif) =>
              html`<option value=${tif} title=${TIME_IN_FORCE_DESCRIPTIONS[tif]} ?selected=${tif === state.timeInForce}>
                ${TIME_IN_FORCE_LABELS[tif]}
              </option>`,
          )}
        </select>
      </div>
      ${gtd
        ? html`<div class="row" part="field expiry-field">
            <label for="expiresAt">Expires</label>
            <input
              id="expiresAt"
              type="datetime-local"
              class="field"
              part="input expiry-input"
              .value=${live(toLocalInput(state.expiresAt))}
              ?disabled=${!state.editable.timeInForce}
              aria-invalid=${state.visibleErrors.expiresAt ? 'true' : 'false'}
              aria-describedby=${state.visibleErrors.expiresAt ? 'expiresAt-error' : nothing}
              @change=${(event: Event) => {
                const text = (event.target as HTMLInputElement).value;
                controller.setExpiresAt(text ? new Date(text).getTime() : undefined);
              }}
            />
            ${this.#error(state, 'expiresAt')}
          </div>`
        : nothing}
    </div>`;
  }

  #renderExits(state: OrderTicketState, decimals: number): TemplateResult {
    const controller = this.activeController as OrderTicketController;
    const format = (price: number | undefined) => formatAmount(price, decimals);
    return html`<fieldset part="exits">
      <legend>Exits</legend>
      ${EXIT_FIELDS.map((field) => {
        const draft = state[field];
        const label = EXIT_LABELS[field];
        const inputField = `${field}-${draft.mode}`;
        const hint =
          draft.mode === 'price'
            ? draft.resolvedTicks !== undefined && Number.isFinite(draft.resolvedTicks)
              ? `${Math.round(draft.resolvedTicks * 100) / 100} ticks`
              : ''
            : draft.resolvedPrice !== undefined
              ? `at ${format(draft.resolvedPrice)}`
              : '';
        return html`<div class="row" part="exit ${field === 'takeProfit' ? 'take-profit' : 'stop-loss'}">
          <div class="exit-head">
            <label class="check">
              <input
                type="checkbox"
                part="checkbox"
                .checked=${live(draft.enabled)}
                ?disabled=${!state.editable.exits}
                @change=${(event: Event) => controller.setExitEnabled(field, (event.target as HTMLInputElement).checked)}
              />
              ${label}
            </label>
            ${draft.enabled
              ? segmented({
                  label: `${label} entry`,
                  choices: EXIT_MODES,
                  selected: draft.mode,
                  disabled: !state.editable.exits,
                  part: 'exit-mode',
                  className: 'small',
                  onSelect: (mode) => controller.setExitMode(field, mode),
                })
              : nothing}
          </div>
          ${draft.enabled
            ? html`${this.#numberInput(
                  state,
                  inputField,
                  draft.mode === 'price' ? draft.price : draft.ticks,
                  draft.mode === 'price' ? decimals : 0,
                  (value) => (draft.mode === 'price' ? controller.setExitPrice(field, value) : controller.setExitTicks(field, value)),
                  {
                    part: field === 'takeProfit' ? 'take-profit-input' : 'stop-loss-input',
                    disabled: !state.editable.exits,
                    label: `${label} ${draft.mode === 'price' ? 'price' : 'distance in ticks'}`,
                    errorField: field,
                    onStep: (steps) => controller.stepPrice(field, steps),
                  },
                )}
                <span class="hint muted" part="hint">${hint}</span> ${this.#error(state, field, inputField)}`
            : nothing}
        </div>`;
      })}
    </fieldset>`;
  }

  #estimates(items: readonly EstimateItem[], part: string, label: string): TemplateResult {
    return html`<dl part=${part} aria-label=${label}>
      ${items.map((item) => html`<dt>${item.label}</dt><dd data-id=${item.id}>${item.text}</dd>`)}
    </dl>`;
  }

  #renderReview(state: OrderTicketState): TemplateResult {
    const controller = this.activeController as OrderTicketController;
    const review = state.review!;
    return html`<div class="review" part="review" role="group" aria-labelledby="review-title">
      <strong id="review-title">Confirm: ${state.summary}</strong>
      ${review.estimates.length > 0 ? this.#estimates(review.estimates, 'review-estimates', 'Broker estimates') : nothing}
      ${review.warnings.length > 0
        ? html`<ul part="review-warnings">
            ${review.warnings.map((warning) => html`<li>${warning}</li>`)}
          </ul>`
        : nothing}
      <div class="actions">
        <button type="button" class="btn ${state.side} submit" part="confirm-button" @click=${() => void controller.confirm()}>
          Confirm
        </button>
        <button type="button" class="btn" part="back-button" @click=${() => controller.cancelReview()}>Back</button>
      </div>
    </div>`;
  }

  #renderSubmit(state: OrderTicketState, usable: boolean): TemplateResult {
    const controller = this.activeController as OrderTicketController;
    const label =
      state.phase === 'checking'
        ? 'Checking…'
        : state.phase === 'submitting'
          ? 'Sending…'
          : state.mode === 'amend'
            ? 'Change order'
            : state.summary;
    return html`<div class="actions">
      <button
        type="submit"
        class="btn ${state.mode === 'amend' ? 'primary' : state.side} submit"
        part="submit-button"
        ?disabled=${!usable || state.busy}
        aria-busy=${state.busy ? 'true' : 'false'}
      >
        ${label}
      </button>
      ${state.mode === 'amend'
        ? html`<button type="button" class="btn" part="cancel-amend-button" ?disabled=${state.busy} @click=${() => controller.cancelAmend()}>
            Cancel
          </button>`
        : nothing}
    </div>`;
  }

  #onSubmit = (event: Event): void => {
    event.preventDefault();
    void this.activeController?.submit();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'tdk-order-ticket': TdkOrderTicketElement;
  }
}
