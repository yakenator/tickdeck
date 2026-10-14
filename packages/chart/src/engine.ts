// The only module besides the trading figures that knows the engine's types. Nothing here is exported publicly.
import { registerIndicator, registerOverlay, registerYAxis, type Chart as EngineChart } from '@tickdeck/chart-engine';
import type { Bar } from '@tickdeck/core';
import { parseTimeframe } from '@tickdeck/datafeed';
import type { ChartColors } from './theme';
import type { ChartStyle, PriceScaleMode } from './types';

export type { EngineChart };
type EngineStyles = Exclude<Parameters<EngineChart['setStyles']>[0], string>;
type EnginePeriod = Parameters<EngineChart['setPeriod']>[0];
type EngineOverlayCreate = Exclude<Parameters<EngineChart['createOverlay']>[0], string | readonly unknown[]>;
type EngineOverlayTemplate = Parameters<typeof registerOverlay>[0];
export type EngineBar = ReturnType<EngineChart['getDataList']>[number];
export type EngineOverlayEvent = Parameters<NonNullable<EngineOverlayCreate['onClick']>>[0];
export type EngineFigure = Extract<ReturnType<NonNullable<EngineOverlayTemplate['createPointFigures']>>, readonly unknown[]>[number];
export type EngineAxisRange = ReturnType<ReturnType<EngineChart['getYAxes']>[number]['getRange']>;

export const CANDLE_PANE = 'candle_pane';

const INDEXED_AXIS = 'tdkIndexed';

/** The volume histogram: an indicator, its own pane, or its own hidden scale in the price pane. */
export const VOLUME_INDICATOR = 'tdkVolume';
export const VOLUME_PANE = 'tdk_volume_pane';
export const VOLUME_AXIS = 'tdk_volume_axis';
/** Share of the price pane's height the tallest volume bar reaches in overlay mode. */
export const VOLUME_OVERLAY_SHARE = 0.22;

/** Flat colors of volume bars: rising, falling and unchanged bars. Passed as the indicator's `extendData`. */
export interface VolumeColors {
  up: string;
  down: string;
  flat: string;
}

interface VolumeDatum {
  volume?: number;
  open: number;
  close: number;
}

/**
 * The volume scale in overlay mode: from 0, with the tallest visible bar at
 * `share` of the pane's height, so the bars stay at the bottom and the price
 * scale is never involved.
 */
export function volumeOverlayRange(range: { to: number }, share: number = VOLUME_OVERLAY_SHARE): EngineAxisRange {
  const to = range.to > 0 ? range.to / share : 1;
  return { from: 0, to, range: to, realFrom: 0, realTo: to, realRange: to, displayFrom: 0, displayTo: to, displayRange: to };
}

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
  registerIndicator<VolumeDatum, number, VolumeColors>({
    name: VOLUME_INDICATOR,
    shortName: 'Volume',
    series: 'volume',
    precision: 0,
    shouldFormatBigNumber: true,
    minValue: 0,
    figures: [
      {
        key: 'volume',
        title: '',
        type: 'bar',
        baseValue: 0,
        styles: ({ data, indicator }) => {
          const bar = data.current;
          const colors = indicator.extendData as VolumeColors;
          return { color: !bar ? colors.flat : bar.close > bar.open ? colors.up : bar.close < bar.open ? colors.down : colors.flat };
        },
      },
    ],
    calc: (bars) => bars.map((bar) => ({ volume: bar.volume, open: bar.open, close: bar.close })),
  });
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
    // The volume histogram's legend: its name in muted text, the value in the bar's color.
    indicator: {
      tooltip: {
        title: { color: colors.textMuted, family },
        legend: { color: colors.textMuted, family },
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
