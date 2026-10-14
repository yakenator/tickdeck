import {
  AccountPanelController,
  type AccountPanelState,
  type AccountTab,
  type OrderFilter,
  type OrderRow,
  type PanelColumn,
  type PanelRow,
  type PositionRow,
  type WidgetContext,
} from '@tickdeck/widgets-core';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { TdkWidgetElement } from './base';
import { NumberDrafts, rovingIndex } from './controls';
import type {
  TdkActionErrorDetail,
  TdkAmendDetail,
  TdkCancelOrderDetail,
  TdkClosePositionDetail,
  TdkEditExitsDetail,
  TdkReversePositionDetail,
  TdkTabChangeDetail,
} from './events';

const TABS: readonly AccountTab[] = ['orders', 'positions', 'fills'];
const TAB_LABELS: Record<AccountTab, string> = { orders: 'Orders', positions: 'Positions', fills: 'Fills' };
const FILTERS: readonly { value: OrderFilter; label: string }[] = [
  { value: 'working', label: 'Working' },
  { value: 'all', label: 'All' },
];

/**
 * Orders, positions and fills of the active account with a balance summary.
 *
 * @element tdk-account-panel
 * @fires tdk-cancel-order - Cancelable. The user asked to cancel an order.
 * @fires tdk-amend - The user wants to change a working order.
 * @fires tdk-close-position - Cancelable. The user asked to close a position.
 * @fires tdk-reverse-position - Cancelable. The user asked to reverse a position.
 * @fires tdk-edit-exits - The user wants to change a position's exits.
 * @fires tdk-action-error - An action failed.
 * @fires tdk-tab-change - The selected tab changed.
 */
export class TdkAccountPanelElement extends TdkWidgetElement<AccountPanelController> {
  static override properties = {
    ...TdkWidgetElement.properties,
    tab: { reflect: true },
    orderFilter: { attribute: 'order-filter' },
  };

  static override styles = [
    ...TdkWidgetElement.styles,
    css`
      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--_space-2);
        padding: var(--_space-2);
        border: 1px solid var(--_c-border);
        border-radius: var(--_radius);
        background: var(--_c-surface);
        min-width: 0;
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--_space-2) var(--_space-3);
        margin: 0;
      }
      .account {
        font-weight: 600;
      }
      .metric {
        display: flex;
        flex-direction: column;
      }
      .metric dt {
        font-size: var(--_fs-1);
        color: var(--_c-text-muted);
      }
      .metric dd {
        margin: 0;
        font-size: var(--_fs-3);
        font-variant-numeric: tabular-nums;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-2);
        border-bottom: 1px solid var(--_c-border);
      }
      [role='tablist'] {
        display: flex;
        gap: var(--_space-1);
      }
      [role='tab'] {
        appearance: none;
        border: 0;
        border-bottom: 2px solid transparent;
        background: none;
        padding: var(--_space-1) var(--_space-2);
        cursor: pointer;
        color: var(--_c-text-muted);
      }
      [role='tab'][aria-selected='true'] {
        color: var(--_c-text);
        border-bottom-color: var(--_c-accent);
        font-weight: 600;
      }
      .count {
        display: inline-block;
        min-width: 1.5em;
        margin-inline-start: var(--_space-1);
        padding: 0 var(--_space-1);
        border-radius: var(--_radius);
        background: var(--_c-surface-2);
        font-size: var(--_fs-1);
        text-align: center;
      }
      .scroll {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        white-space: nowrap;
      }
      th,
      td {
        padding: var(--_space-1) var(--_space-2);
        border-bottom: 1px solid var(--_c-border);
        text-align: start;
      }
      th {
        font-weight: 500;
        font-size: var(--_fs-1);
        color: var(--_c-text-muted);
      }
      th.num,
      td.num {
        text-align: end;
      }
      .sort {
        appearance: none;
        border: 0;
        background: none;
        padding: 0;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .arrow {
        display: inline-block;
        width: 1em;
      }
      tr.child td:nth-child(2) {
        padding-inline-start: var(--_space-3);
      }
      tr[aria-busy='true'] {
        opacity: 0.6;
      }
      td.actions {
        text-align: end;
      }
      td.actions .btn + .btn {
        margin-inline-start: var(--_space-1);
      }
      .close-form {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--_space-2);
        padding: var(--_space-1) 0;
      }
      .close-form .field {
        width: 8em;
      }
      .banner,
      .empty {
        margin: 0;
        padding: var(--_space-2);
        border-radius: var(--_radius);
        background: var(--_c-surface-2);
        color: var(--_c-text-muted);
      }
      .banner.error {
        display: flex;
        justify-content: space-between;
        gap: var(--_space-2);
        color: var(--_c-error);
      }
    `,
  ];

  /** Initial tab: `orders`, `positions` or `fills`. */
  declare tab: AccountTab | undefined;
  /** Initial order filter: `working` or `all`. */
  declare orderFilter: OrderFilter | undefined;

  readonly #drafts = new NumberDrafts();
  #focusedClose: string | undefined;

  protected override createController(context: WidgetContext): AccountPanelController {
    return new AccountPanelController(context, { tab: this.tab, orderFilter: this.orderFilter });
  }

  protected override listen(controller: AccountPanelController): (() => void)[] {
    return [
      controller.on('amend', (order) => this.dispatch<TdkAmendDetail>('tdk-amend', { order })),
      controller.on('edit-exits', (position) => this.dispatch<TdkEditExitsDetail>('tdk-edit-exits', { position })),
      controller.on('action-error', (detail) => this.dispatch<TdkActionErrorDetail>('tdk-action-error', detail)),
    ];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    const controller = this.activeController;
    if (!controller) return;
    if (changed.has('tab') && this.tab) controller.setTab(this.tab);
    if (changed.has('orderFilter') && this.orderFilter) controller.setOrderFilter(this.orderFilter);
  }

  protected override updated(): void {
    const closing = this.activeController?.state.value.closing?.positionId;
    if (closing && closing !== this.#focusedClose) {
      const input = this.renderRoot.querySelector<HTMLInputElement>('#close-quantity');
      input?.focus();
      input?.select();
    }
    this.#focusedClose = closing;
  }

  protected override render(): TemplateResult {
    const controller = this.activeController;
    const state = controller?.state.value;
    if (!controller || !state) {
      return html`<section class="panel" part="panel"><p class="empty" part="status">No trading session</p></section>`;
    }
    return html`<section class="panel" part="panel" aria-label="Account">
      ${this.#renderSummary(state)} ${this.#renderStatus(state)}
      ${state.error
        ? html`<div class="banner error" part="error" role="alert">
            <span>${state.error}</span>
            <button type="button" class="btn small" aria-label="Dismiss error" @click=${() => controller.clearError()}>×</button>
          </div>`
        : nothing}
      <div class="bar">
        <div role="tablist" aria-label="Account views" part="tabs" @keydown=${this.#onTabKey}>
          ${TABS.map(
            (tab) =>
              html`<button
                type="button"
                role="tab"
                id="tab-${tab}"
                part=${state.tab === tab ? 'tab tab-selected' : 'tab'}
                aria-selected=${state.tab === tab ? 'true' : 'false'}
                aria-controls="tabpanel"
                tabindex=${state.tab === tab ? 0 : -1}
                @click=${() => this.#selectTab(tab)}
              >
                ${TAB_LABELS[tab]}<span class="count" part="count">${state.counts[tab]}</span>
              </button>`,
          )}
        </div>
        ${state.tab === 'orders'
          ? html`<div class="segmented small" role="group" aria-label="Show orders" part="filter">
              ${FILTERS.map(
                (filter) =>
                  html`<button
                    type="button"
                    aria-pressed=${state.orderFilter === filter.value ? 'true' : 'false'}
                    @click=${() => controller.setOrderFilter(filter.value)}
                  >
                    ${filter.label}
                  </button>`,
              )}
            </div>`
          : nothing}
      </div>
      <div role="tabpanel" id="tabpanel" aria-labelledby="tab-${state.tab}" part="tabpanel" class="scroll">
        ${this.#renderTab(state)}
      </div>
    </section>`;
  }

  #renderSummary(state: AccountPanelState): TemplateResult {
    const summary = state.summary;
    if (!summary) return html`<dl class="summary" part="summary"></dl>`;
    return html`<dl class="summary" part="summary" aria-label="Account summary">
      <div class="metric account" part="summary-account">
        <dt>${summary.accountName ?? summary.accountId}</dt>
        <dd>${summary.currency}</dd>
      </div>
      ${summary.items.map(
        (item) =>
          html`<div class="metric" part="summary-item">
            <dt>${item.label}</dt>
            <dd class=${item.tone ? `tone-${item.tone}` : ''} data-id=${item.id}>${item.text}</dd>
          </div>`,
      )}
    </dl>`;
  }

  #renderStatus(state: AccountPanelState): TemplateResult | typeof nothing {
    if (state.status === 'ready') return nothing;
    const text =
      state.status === 'loading'
        ? 'Loading account…'
        : `Not connected to the broker${state.message ? `: ${state.message}` : ''}`;
    return html`<p class="banner" part="status" role="status">${text}</p>`;
  }

  #renderTab(state: AccountPanelState): TemplateResult {
    switch (state.tab) {
      case 'orders':
        return this.#table(
          state.columns.orders,
          state.orders,
          state,
          state.orderFilter === 'working' ? 'No working orders' : 'No orders',
          (row) => this.#orderActions(row),
        );
      case 'positions':
        return this.#table(state.columns.positions, state.positions, state, 'No open positions', (row) =>
          this.#positionActions(row),
        );
      case 'fills':
        return this.#table(state.columns.fills, state.fills, state, 'No fills yet');
    }
  }

  #table<R extends PanelRow<unknown>>(
    columns: readonly PanelColumn[],
    rows: readonly R[],
    state: AccountPanelState,
    emptyText: string,
    actions?: (row: R) => TemplateResult,
  ): TemplateResult {
    if (rows.length === 0) return html`<p class="empty" part="empty">${emptyText}</p>`;
    const sort = state.sort[state.tab];
    const span = columns.length + (actions ? 1 : 0);
    return html`<table part="table">
      <thead>
        <tr part="header-row">
          ${columns.map((column) => {
            const sorted = sort.column === column.id;
            return html`<th
              scope="col"
              class=${column.numeric ? 'num' : ''}
              aria-sort=${sorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" class="sort" part="sort-button" @click=${() => this.activeController?.sortBy(column.id)}>
                ${column.label}<span class="arrow" aria-hidden="true">${sorted ? (sort.direction === 'asc' ? '▲' : '▼') : ''}</span>
              </button>
            </th>`;
          })}
          ${actions ? html`<th scope="col"><span class="visually-hidden">Actions</span></th>` : nothing}
        </tr>
      </thead>
      <tbody>
        ${repeat(
          rows,
          (row) => row.id,
          (row) => html`<tr
              part="row"
              class=${(row as Partial<OrderRow>).parentId ? 'child' : ''}
              aria-busy=${row.busy ? 'true' : 'false'}
              data-id=${row.id}
              title=${(row.item as { message?: string }).message ?? nothing}
            >
              ${columns.map((column) => {
                const tone = row.tones[column.id];
                return html`<td class="${column.numeric ? 'num' : ''} ${tone ? `tone-${tone}` : ''}" data-column=${column.id}>
                  ${row.cells[column.id]}
                </td>`;
              })}
              ${actions ? html`<td class="actions" part="actions">${actions(row)}</td>` : nothing}
            </tr>
            ${state.closing?.positionId === row.id ? this.#closeRow(state, span) : nothing}`,
        )}
      </tbody>
    </table>`;
  }

  #orderActions(row: OrderRow): TemplateResult {
    if (!row.working) return html``;
    return html`<button
        type="button"
        class="btn small"
        part="action-button amend-button"
        ?disabled=${!row.canAmend}
        aria-label="Modify order: ${row.label}"
        @click=${() => this.activeController?.requestAmend(row.id)}
      >
        Modify</button
      ><button
        type="button"
        class="btn small"
        part="action-button cancel-button"
        ?disabled=${!row.canCancel}
        aria-label="Cancel order: ${row.label}"
        @click=${() => this.#cancelOrder(row)}
      >
        Cancel
      </button>`;
  }

  #positionActions(row: PositionRow): TemplateResult {
    return html`${row.canEditExits
        ? html`<button
            type="button"
            class="btn small"
            part="action-button exits-button"
            aria-label="Edit take-profit and stop-loss: ${row.label}"
            @click=${() => this.activeController?.requestEditExits(row.id)}
          >
            TP/SL
          </button>`
        : nothing}<button
        type="button"
        class="btn small"
        part="action-button reverse-button"
        ?disabled=${!row.canReverse}
        aria-label="Reverse position: ${row.label}"
        @click=${() => this.#reversePosition(row)}
      >
        Reverse</button
      ><button
        type="button"
        class="btn small"
        part="action-button close-button"
        ?disabled=${!row.canClose}
        aria-label="Close position: ${row.label}"
        @click=${() => this.#closePosition(row)}
      >
        Close
      </button>`;
  }

  #closeRow(state: AccountPanelState, span: number): TemplateResult {
    const closing = state.closing;
    const controller = this.activeController;
    if (!closing || !controller) return html``;
    const row = state.positions.find((candidate) => candidate.id === closing.positionId);
    const quantity = this.#drafts.text('close', closing.quantity, 0);
    return html`<tr class="close-row" part="close-row">
      <td colspan=${span}>
        <form class="close-form" @submit=${this.#confirmClose} @keydown=${this.#onCloseKey}>
          <label for="close-quantity">Close quantity</label>
          <input
            id="close-quantity"
            class="field num"
            part="input"
            inputmode="decimal"
            autocomplete="off"
            .value=${live(quantity)}
            aria-invalid=${closing.error ? 'true' : 'false'}
            aria-describedby="close-hint close-error"
            @input=${(event: Event) =>
              controller.setCloseQuantity(this.#drafts.type('close', (event.target as HTMLInputElement).value))}
            @change=${() => this.#drafts.release('close')}
          />
          <span id="close-hint" class="muted">of ${row?.cells.quantity ?? closing.maximum}</span>
          <button type="submit" class="btn small primary" part="confirm-close-button">Close position</button>
          <button type="button" class="btn small" part="cancel-close-button" @click=${() => controller.cancelClose()}>
            Cancel
          </button>
          <span id="close-error" class="error-text" role="alert">${closing.error ?? ''}</span>
        </form>
      </td>
    </tr>`;
  }

  #selectTab(tab: AccountTab): void {
    const controller = this.activeController;
    if (!controller || controller.state.value.tab === tab) return;
    controller.setTab(tab);
    this.dispatch<TdkTabChangeDetail>('tdk-tab-change', { tab });
  }

  #onTabKey = (event: KeyboardEvent): void => {
    const current = TABS.indexOf(this.activeController?.state.value.tab ?? 'orders');
    const next = rovingIndex(event.key, current, TABS.length);
    const tab = next === undefined ? undefined : TABS[next];
    if (!tab) return;
    event.preventDefault();
    this.#selectTab(tab);
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`#tab-${tab}`)?.focus());
  };

  #cancelOrder(row: OrderRow): void {
    if (this.dispatch<TdkCancelOrderDetail>('tdk-cancel-order', { order: row.item }, true)) {
      void this.activeController?.cancelOrder(row.id);
    }
  }

  #closePosition(row: PositionRow): void {
    const controller = this.activeController;
    if (!controller) return;
    if (row.canPartialClose) {
      controller.beginClose(row.id);
      return;
    }
    if (this.dispatch<TdkClosePositionDetail>('tdk-close-position', { position: row.item }, true)) {
      void controller.closePosition(row.id);
    }
  }

  #confirmClose = (event: Event): void => {
    event.preventDefault();
    const controller = this.activeController;
    const closing = controller?.state.value.closing;
    const position = closing ? controller?.session.getPosition(closing.positionId) : undefined;
    if (!controller || !closing || !position) return;
    if (closing.error) return;
    const quantity = closing.quantity === position.quantity ? undefined : closing.quantity;
    if (this.dispatch<TdkClosePositionDetail>('tdk-close-position', { position, quantity }, true)) {
      void controller.confirmClose();
    } else {
      controller.cancelClose();
    }
  };

  #onCloseKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const positionId = this.activeController?.state.value.closing?.positionId;
    this.activeController?.cancelClose();
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`tr[data-id="${positionId}"] [part~='close-button']`)?.focus(),
    );
  };

  #reversePosition(row: PositionRow): void {
    if (this.dispatch<TdkReversePositionDetail>('tdk-reverse-position', { position: row.item }, true)) {
      void this.activeController?.reversePosition(row.id);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tdk-account-panel': TdkAccountPanelElement;
  }
}
