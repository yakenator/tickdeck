import { css, unsafeCSS, type CSSResult } from 'lit';

type Palette = Record<string, string>;

/** Default colours. Every one can be overridden with `--tdk-color-<name>`. */
const LIGHT: Palette = {
  surface: '#ffffff',
  'surface-2': '#f3f5f7',
  text: '#1b1f24',
  'text-muted': '#5b6470',
  border: '#d4d8de',
  accent: '#2f6fdf',
  'on-accent': '#ffffff',
  buy: '#1a7f5a',
  'on-buy': '#ffffff',
  'buy-text': '#1a7f5a',
  sell: '#c4314b',
  'on-sell': '#ffffff',
  'sell-text': '#c4314b',
  positive: '#1a7f5a',
  negative: '#c4314b',
  info: '#2f6fdf',
  success: '#1a7f5a',
  warning: '#9a5b00',
  error: '#c4314b',
  focus: '#2f6fdf',
};

const DARK: Palette = {
  surface: '#15191e',
  'surface-2': '#1f252c',
  text: '#e6e9ed',
  'text-muted': '#9aa4af',
  border: '#343c46',
  accent: '#5b94f0',
  'on-accent': '#0b1220',
  buy: '#1a7f5a',
  'on-buy': '#ffffff',
  'buy-text': '#3fc28d',
  sell: '#c4314b',
  'on-sell': '#ffffff',
  'sell-text': '#f2687e',
  positive: '#3fc28d',
  negative: '#f2687e',
  info: '#6aa2f5',
  success: '#3fc28d',
  warning: '#e3a63c',
  error: '#f2687e',
  focus: '#6aa2f5',
};

/** Every colour token, for documentation and tests. */
export const COLOR_TOKENS: readonly string[] = Object.keys(LIGHT).map((name) => `--tdk-color-${name}`);

const palette = (colors: Palette): CSSResult =>
  unsafeCSS(
    Object.entries(colors)
      .map(([name, value]) => `--_c-${name}: var(--tdk-color-${name}, ${value});`)
      .join('\n'),
  );

/**
 * Resolves the public `--tdk-*` tokens into private `--_*` variables with
 * light defaults; `theme="dark"` (or `theme="auto"` with a dark system
 * preference) switches the defaults. Tokens set by the page always win.
 */
export const themeStyles = css`
  :host {
    ${palette(LIGHT)}
    --_font: var(--tdk-font-family, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
    --_fs-1: var(--tdk-font-size-1, 12px);
    --_fs-2: var(--tdk-font-size-2, 13px);
    --_fs-3: var(--tdk-font-size-3, 16px);
    --_space-1: var(--tdk-space-1, 4px);
    --_space-2: var(--tdk-space-2, 8px);
    --_space-3: var(--tdk-space-3, 12px);
    --_radius: var(--tdk-radius, 4px);
    --_control-height: var(--tdk-control-height, 30px);
    color-scheme: light;
  }
  :host([theme='dark']) {
    ${palette(DARK)}
    color-scheme: dark;
  }
  @media (prefers-color-scheme: dark) {
    :host([theme='auto']) {
      ${palette(DARK)}
      color-scheme: dark;
    }
  }
`;

export const baseStyles = css`
  :host {
    display: block;
    box-sizing: border-box;
    font-family: var(--_font);
    font-size: var(--_fs-2);
    line-height: 1.4;
    color: var(--_c-text);
    background: var(--_c-surface);
  }
  :host([hidden]) {
    display: none;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  button,
  input,
  select {
    font: inherit;
    color: inherit;
  }
  :focus-visible {
    outline: 2px solid var(--_c-focus);
    outline-offset: 1px;
  }
  .btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--_space-1);
    min-height: var(--_control-height);
    padding: 0 var(--_space-3);
    border: 1px solid var(--_c-border);
    border-radius: var(--_radius);
    background: var(--_c-surface-2);
    color: var(--_c-text);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    border-color: var(--_c-text-muted);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.small {
    min-height: 24px;
    padding: 0 var(--_space-2);
    font-size: var(--_fs-1);
  }
  .btn.primary {
    background: var(--_c-accent);
    border-color: var(--_c-accent);
    color: var(--_c-on-accent);
  }
  .btn.buy {
    background: var(--_c-buy);
    border-color: var(--_c-buy);
    color: var(--_c-on-buy);
  }
  .btn.sell {
    background: var(--_c-sell);
    border-color: var(--_c-sell);
    color: var(--_c-on-sell);
  }
  .btn.buy:hover:not(:disabled),
  .btn.sell:hover:not(:disabled),
  .btn.primary:hover:not(:disabled) {
    border-color: var(--_c-text);
  }
  .field {
    width: 100%;
    min-height: var(--_control-height);
    padding: 0 var(--_space-2);
    border: 1px solid var(--_c-border);
    border-radius: var(--_radius);
    background: var(--_c-surface);
    color: var(--_c-text);
  }
  .field:disabled {
    opacity: 0.6;
  }
  .field[aria-invalid='true'] {
    border-color: var(--_c-error);
  }
  .num {
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
  .muted {
    color: var(--_c-text-muted);
  }
  .tone-buy {
    color: var(--_c-buy-text);
  }
  .tone-sell {
    color: var(--_c-sell-text);
  }
  .tone-positive {
    color: var(--_c-positive);
  }
  .tone-negative {
    color: var(--_c-negative);
  }
  .tone-muted {
    color: var(--_c-text-muted);
  }
  .error-text {
    color: var(--_c-error);
    font-size: var(--_fs-1);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  .segmented {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--_c-border);
    border-radius: var(--_radius);
    overflow: hidden;
  }
  .segmented > button {
    appearance: none;
    flex: 1 1 auto;
    min-height: var(--_control-height);
    padding: 0 var(--_space-2);
    border: 0;
    border-inline-start: 1px solid var(--_c-border);
    background: var(--_c-surface);
    color: var(--_c-text);
    cursor: pointer;
  }
  .segmented > button:first-child {
    border-inline-start: 0;
  }
  .segmented > button[aria-checked='true'],
  .segmented > button[aria-pressed='true'] {
    background: var(--_c-accent);
    color: var(--_c-on-accent);
  }
  .segmented > button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .segmented > button:focus-visible {
    outline-offset: -2px;
  }
  .segmented.small > button {
    min-height: 24px;
    font-size: var(--_fs-1);
  }
`;
