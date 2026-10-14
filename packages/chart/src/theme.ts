export type ChartThemeName = 'light' | 'dark';

/**
 * Flat colors the chart paints with. Every value is a CSS color; there are
 * no gradients anywhere, and the area fill is one semi-transparent color.
 */
export interface ChartColors {
  /** Chart background. Token: `--tdk-color-surface`. */
  background: string;
  /** Titles and strong text. Token: `--tdk-color-text`. */
  text: string;
  /** Axis labels and secondary text. Token: `--tdk-color-text-muted`. */
  textMuted: string;
  /** Grid lines. Token: `--tdk-color-grid`. */
  grid: string;
  /** Axis lines and separators. Token: `--tdk-color-border`. */
  border: string;
  /** Crosshair lines. */
  crosshair: string;
  /** Background of the crosshair's axis labels. */
  crosshairLabel: string;
  /** Rising candles and bars. Token: `--tdk-color-buy`. */
  up: string;
  /** Falling candles and bars. Token: `--tdk-color-sell`. */
  down: string;
  /** Line and area series. Token: `--tdk-color-accent`. */
  line: string;
  /** Area series fill: a flat, semi-transparent color. Derived from `line` when a token sets it. */
  areaFill: string;
  /** Buy orders and buy fills. Token: `--tdk-color-buy`. */
  buy: string;
  /** Sell orders and sell fills. Token: `--tdk-color-sell`. */
  sell: string;
  /** Take-profit lines. Token: `--tdk-color-take-profit`. */
  takeProfit: string;
  /** Stop-loss lines. Token: `--tdk-color-stop-loss`. */
  stopLoss: string;
  /** Position lines. Token: `--tdk-color-position`. */
  position: string;
  /** Lines and labels while a broker action awaits confirmation. */
  pending: string;
  /** Text on colored labels. */
  labelText: string;
  /** Token: `--tdk-font-family`. */
  fontFamily: string;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Built-in color sets for `setTheme('light')` and `setTheme('dark')`. */
export const chartThemes: Readonly<Record<ChartThemeName, Readonly<ChartColors>>> = {
  light: {
    background: '#ffffff',
    text: '#1b1f24',
    textMuted: '#667085',
    grid: '#eef0f3',
    border: '#d0d5dd',
    crosshair: '#667085',
    crosshairLabel: '#344054',
    up: '#1a7f5a',
    down: '#c4314b',
    line: '#2563eb',
    areaFill: 'rgba(37, 99, 235, 0.16)',
    buy: '#1a7f5a',
    sell: '#c4314b',
    takeProfit: '#0f8b8d',
    stopLoss: '#d9480f',
    position: '#6d28d9',
    pending: '#98a2b3',
    labelText: '#ffffff',
    fontFamily: FONT,
  },
  dark: {
    background: '#111418',
    text: '#e6e8eb',
    textMuted: '#98a2b3',
    grid: '#1f242b',
    border: '#2e353f',
    crosshair: '#98a2b3',
    crosshairLabel: '#3b4452',
    up: '#2ea47a',
    down: '#e5484d',
    line: '#4f8cff',
    areaFill: 'rgba(79, 140, 255, 0.18)',
    buy: '#2ea47a',
    sell: '#e5484d',
    takeProfit: '#22a6a8',
    stopLoss: '#f0883e',
    position: '#9b7bf0',
    pending: '#667085',
    labelText: '#ffffff',
    fontFamily: FONT,
  },
};

/** CSS custom properties read from the chart's container, and the colors each one sets. */
const TOKENS: ReadonlyArray<readonly [string, readonly (keyof ChartColors)[]]> = [
  ['--tdk-color-surface', ['background']],
  ['--tdk-color-text', ['text']],
  ['--tdk-color-text-muted', ['textMuted', 'crosshair']],
  ['--tdk-color-grid', ['grid']],
  ['--tdk-color-border', ['border']],
  ['--tdk-color-accent', ['line']],
  ['--tdk-color-buy', ['buy', 'up']],
  ['--tdk-color-sell', ['sell', 'down']],
  ['--tdk-color-take-profit', ['takeProfit']],
  ['--tdk-color-stop-loss', ['stopLoss']],
  ['--tdk-color-position', ['position']],
  ['--tdk-font-family', ['fontFamily']],
];

/** Reads the `--tdk-*` tokens that are set on (or inherited by) `element`. */
export function readChartColorTokens(element: Element): Partial<ChartColors> {
  const view = element.ownerDocument?.defaultView;
  if (!view) return {};
  const style = view.getComputedStyle(element);
  const colors: Partial<ChartColors> = {};
  for (const [token, keys] of TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value) for (const key of keys) colors[key] = value;
  }
  return colors;
}

/** `rgba()` for a `#rgb` or `#rrggbb` color, or `undefined` for other syntaxes. */
export function withAlpha(color: string, alpha: number): string | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return undefined;
  const hex = match[1] as string;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Colors for a theme: the built-in set, then any `--tdk-*` tokens, then
 * explicit overrides. When `line` changes without an explicit `areaFill`, the
 * fill is derived from it.
 */
export function resolveChartColors(
  theme: ChartThemeName,
  tokens: Partial<ChartColors> = {},
  overrides: Partial<ChartColors> = {},
): ChartColors {
  const base = chartThemes[theme];
  const colors: ChartColors = { ...base, ...tokens, ...overrides };
  if (overrides.areaFill === undefined && colors.line !== base.line) {
    colors.areaFill = withAlpha(colors.line, 0.16) ?? base.areaFill;
  }
  return colors;
}
