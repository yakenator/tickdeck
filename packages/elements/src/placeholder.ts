import type { WidgetContext } from '@tickdeck/widgets-core';
import { LitElement, css, html } from 'lit';

export class TdkPlaceholderElement extends LitElement {
  static override properties = {
    label: { type: String },
    context: { attribute: false },
  };

  static override styles = css`
    :host {
      display: inline-block;
      padding: 8px 12px;
      border: 1px solid var(--tdk-color-border, #d4d8de);
      border-radius: var(--tdk-radius, 4px);
      background: var(--tdk-color-surface, #ffffff);
      color: var(--tdk-color-text, #1b1f24);
      font: 14px/1.4 var(--tdk-font-family, system-ui, sans-serif);
    }
  `;

  declare label: string | undefined;
  declare context: WidgetContext | undefined;

  override render() {
    return html`<span part="label">${this.label || 'tickdeck'}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tdk-placeholder': TdkPlaceholderElement;
  }
}
