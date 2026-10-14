// The only module besides the trading figures that knows the engine's types. Nothing here is exported publicly.
import { registerOverlay, registerYAxis, type Chart as EngineChart } from '@tickdeck/chart-engine';
import type { Bar } from '@tickdeck/core';
import { parseTimeframe } from '@tickdeck/datafeed';
import type { ChartColors } from './theme';
import type { ChartStyle, PriceScaleMode } from './types';

export type { EngineChart };
export type EngineStyles = Exclude<Parameters<EngineChart['setStyles']>[0], string>;
export type EnginePeriod = Parameters<EngineChart['setPeriod']>[0];
export type EngineDataLoader = Parameters<EngineChart['setDataLoader']>[0];
export type EngineBar = ReturnType<EngineChart['getDataList']>[number];
export type EngineOverlayCreate = Exclude<Parameters<EngineChart['createOverlay']>[0], string | readonly unknown[]>;
export type EngineOverlayEvent = Parameters<NonNullable<EngineOverlayCreate['onClick']>>[0];
export type EngineOverlayTemplate = Parameters<typeof registerOverlay>[0];
export type EngineFigure = Extract<ReturnType<NonNullable<EngineOverlayTemplate['createPointFigures']>>, readonly unknown[]>[number];

export const CANDLE_PANE = 'candle_pane';

const INDEXED_AXIS = 'tdkIndexed';

export const AXIS_NAMES: Readonly<Record<PriceScaleMode, string>> = {
  normal: 'normal',
  log: 'logarithm',
  percent: 'percentage',
  indexed: INDEXED_AXIS,
};

const CANDLE_TYPES = {
  candles: 'candle_solid',
  bars: 'ohlc',
  line: 'area',
  area: 'area',
} as const;

let registered = false;

/** Registers the engine extensions tickdeck adds (the indexed price scale). Runs once. */
export function ensureEngineExtensions(): void {
  if (registered) return;
  registered = true;
  // Prices relative to the first visible bar's close, which reads as 100.
  registerYAxis({
    name: INDEXED_AXIS,
    minSpan: () => 0.01,
    displayValueToText: (value) => value.toFixed(2),
    valueToRealValue: (value, { range }) =>
      range.range === 0 ? range.realFrom : ((value - range.from) / range.range) * range.realRange + range.realFrom,
    realValueToValue: (value, { range }) =>
      range.realRange === 0 ? range.from : ((value - range.realFrom) / range.realRange) * range.range + range.from,
    createRange: ({ chart, defaultRange }) => {
      const base = chart.getDataList()[chart.getVisibleRange().from]?.close;
      if (!base) return defaultRange;
      const realFrom = (defaultRange.from / base) * 100;
      const realTo = (defaultRange.to / base) * 100;
      return {
        ...defaultRange,
        realFrom,
        realTo,
        realRange: realTo - realFrom,
        displayFrom: realFrom,
        displayTo: realTo,
        displayRange: realTo - realFrom,
      };
    },
  });
}

/** The engine's period for a timeframe. Tick bars have no time grid and use one second. */
export function enginePeriod(timeframe: string): EnginePeriod {
  const { count, unit } = parseTimeframe(timeframe);
  return unit === 'tick' ? { type: 'second', span: 1 } : { type: unit, span: count };
}

export function toEngineBar(bar: Bar): EngineBar {
  return { timestamp: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
}

/** Engine styles for a color set and series style. Every fill is a flat color. */
export function engineStyles(colors: ChartColors, style: ChartStyle): EngineStyles {
  const family = colors.fontFamily;
  const axis = {
    axisLine: { color: colors.border },
    tickLine: { color: colors.border },
    tickText: { color: colors.textMuted, family },
  };
  const crosshairText = {
    color: colors.labelText,
    backgroundColor: colors.crosshairLabel,
    borderColor: colors.crosshairLabel,
    family,
  };
  return {
    grid: {
      horizontal: { color: colors.grid, style: 'solid' },
      vertical: { color: colors.grid, style: 'solid' },
    },
    candle: {
      type: CANDLE_TYPES[style],
      bar: {
        upColor: colors.up,
        downColor: colors.down,
        noChangeColor: colors.textMuted,
        upBorderColor: colors.up,
        downBorderColor: colors.down,
        noChangeBorderColor: colors.textMuted,
        upWickColor: colors.up,
        downWickColor: colors.down,
        noChangeWickColor: colors.textMuted,
      },
      area: {
        lineColor: colors.line,
        lineSize: 2,
        backgroundColor: style === 'area' ? colors.areaFill : 'transparent',
        point: { show: false },
      },
      priceMark: {
        high: { color: colors.textMuted, textFamily: family },
        low: { color: colors.textMuted, textFamily: family },
        last: {
          upColor: colors.up,
          downColor: colors.down,
          noChangeColor: colors.textMuted,
          text: { color: colors.labelText, family },
        },
      },
      tooltip: {
        title: { color: colors.text, family },
        legend: { color: colors.textMuted, family },
        rect: { color: colors.background, borderColor: colors.border },
      },
    },
    xAxis: axis,
    yAxis: axis,
    separator: { color: colors.border },
    crosshair: {
      horizontal: { line: { color: colors.crosshair }, text: crosshairText },
      vertical: { line: { color: colors.crosshair }, text: crosshairText },
    },
  };
}
