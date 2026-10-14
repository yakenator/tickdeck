import { formatInputNumber, parseInputNumber } from '@tickdeck/widgets-core';
import { html, nothing, type TemplateResult } from 'lit';

const sameNumber = (a: number | undefined, b: number | undefined) => Object.is(a, b) || a === b;

/**
 * Keeps what the user typed in number fields while it still means the
 * controller's value, so re-rendering never rewrites a field mid-typing
 * (`100.` stays `100.`). Any other change of the value replaces the text.
 */
export class NumberDrafts {
  readonly #drafts = new Map<string, string>();

  text(field: string, value: number | undefined, decimals: number): string {
    const draft = this.#drafts.get(field);
    if (draft !== undefined && sameNumber(parseInputNumber(draft), value)) return draft;
    this.#drafts.delete(field);
    return formatInputNumber(value, decimals);
  }

  type(field: string, text: string): number | undefined {
    this.#drafts.set(field, text);
    return parseInputNumber(text);
  }

  /** Called when the field is left: valid entries are reformatted, unreadable text stays for correction. */
  release(field: string): void {
    const draft = this.#drafts.get(field);
    if (draft !== undefined && !Number.isNaN(parseInputNumber(draft))) this.#drafts.delete(field);
  }
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  className?: string;
  title?: string;
}

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Index a roving-focus key moves to, or `undefined` for other keys. */
export function rovingIndex(key: string, current: number, count: number): number | undefined {
  if (count === 0) return undefined;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const step = NEXT_KEYS[key];
  if (step === undefined) return undefined;
  return (current + step + count) % count;
}

/**
 * A single-choice button group (`role="radiogroup"`) with roving focus:
 * arrow keys, Home and End move the selection, Tab leaves the group.
 */
export function segmented<T extends string>(options: {
  label: string;
  choices: readonly Choice<T>[];
  selected: T | undefined;
  disabled?: boolean;
  part: string;
  className?: string;
  onSelect: (value: T) => void;
}): TemplateResult {
  const { choices, selected } = options;
  const select = (value: T, event: Event) => {
    options.onSelect(value);
    const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-value="${value}"]`)?.focus());
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const current = choices.findIndex((choice) => choice.value === selected);
    const next = rovingIndex(event.key, Math.max(0, current), choices.length);
    const choice = next === undefined ? undefined : choices[next];
    if (!choice || options.disabled) return;
    event.preventDefault();
    select(choice.value, event);
  };
  return html`<div
    role="radiogroup"
    aria-label=${options.label}
    class="segmented ${options.className ?? ''}"
    part=${options.part}
    @keydown=${onKeyDown}
  >
    ${choices.map(
      (choice) =>
        html`<button
          type="button"
          role="radio"
          data-value=${choice.value}
          class=${choice.className ?? ''}
          title=${choice.title ?? nothing}
          aria-checked=${choice.value === selected ? 'true' : 'false'}
          tabindex=${choice.value === selected || (selected === undefined && choice === choices[0]) ? 0 : -1}
          ?disabled=${options.disabled}
          @click=${(event: Event) => select(choice.value, event)}
        >
          ${choice.label}
        </button>`,
    )}
  </div>`;
}
