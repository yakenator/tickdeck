// Canvas figures for the trading overlay, registered with the engine as two overlay types.
import { registerOverlay, utils } from '@tickdeck/chart-engine';
import type { EngineFigure } from '../engine';
import type { ChartColors } from '../theme';
import { placeEdgeMarkers, type EdgeMarkerPlace } from './edges';
import type { FillMarker, TradingLine } from './scene';

export const LINE_OVERLAY = 'tdkTradingLine';
export const FILL_OVERLAY = 'tdkFillMarker';

/** Figure keys reported in overlay events. */
export const BODY_KEY = 'body';
export const REMOVE_KEY = 'remove';

/** Everything a line needs to draw itself. */
export interface LineRender {
  line: TradingLine;
  colors: ChartColors;
  formatPrice: (price: number) => string;
  /** P&L text of a position line. */
  pnlText?: string;
  /** Every line of the overlay, to stack the edge markers of lines outside the visible prices. */
  lines: () => readonly TradingLine[];
}

export interface FillRender {
  marker: FillMarker;
  colors: ChartColors;
}

/** Overlay `extendData`: a getter, so the engine's deep merge of `extendData` never sees the model itself. */
export interface RenderSource<T> {
  render: () => T | undefined;
}

const FONT_SIZE = 11;
const LABEL_PADDING_X = 6;
const LABEL_PADDING_Y = 3;
const LABEL_MARGIN = 8;
const HIT_HALF_HEIGHT = 5;
const MARKER_HALF_WIDTH = 5;
const MARKER_HEIGHT = 8;
const LABEL_HEIGHT = FONT_SIZE + LABEL_PADDING_Y * 2;
const EDGE_GAP = 2;
/** Half the height of the engine's price-axis tick labels (12px text). */
const TICK_LABEL_HALF_HEIGHT = 6;
const EDGE_ARROWS = { top: '\u25b2', bottom: '\u25bc' } as const;

/** What figure callbacks know about the price axis. */
interface AxisLike {
  convertToPixel(value: number): number;
}

export function lineColor(line: TradingLine, colors: ChartColors): string {
  if (line.pending) return colors.pending;
  switch (line.kind) {
    case 'take-profit':
      return colors.takeProfit;
    case 'stop-loss':
      return colors.stopLoss;
    case 'position':
      return colors.position;
    case 'order':
      return line.side === 'buy' ? colors.buy : colors.sell;
  }
}

function pnlColor(line: TradingLine, colors: ChartColors): string {
  const value = line.pnl?.money ?? line.pnl?.ticks ?? 0;
  if (line.pending) return colors.pending;
  return value > 0 ? colors.buy : value < 0 ? colors.sell : colors.textMuted;
}

function labelStyles(background: string, colors: ChartColors) {
  return {
    style: 'fill' as const,
    color: colors.labelText,
    size: FONT_SIZE,
    family: colors.fontFamily,
    weight: 'normal',
    paddingLeft: LABEL_PADDING_X,
    paddingRight: LABEL_PADDING_X,
    paddingTop: LABEL_PADDING_Y,
    paddingBottom: LABEL_PADDING_Y,
    backgroundColor: background,
    borderColor: background,
    borderSize: 0,
    borderRadius: 2,
  };
}

function lineFigures(render: LineRender, price: number, y: number, width: number): EngineFigure[] {
  const { line, colors } = render;
  const color = lineColor(line, colors);
  const figures: EngineFigure[] = [
    // A transparent band around the thin line, so it is easy to grab.
    {
      key: BODY_KEY,
      type: 'rect',
      attrs: { x: 0, y: y - HIT_HALF_HEIGHT, width, height: HIT_HALF_HEIGHT * 2 },
      styles: { style: 'fill', color: 'transparent', borderSize: 0 },
    },
    {
      key: BODY_KEY,
      type: 'line',
      attrs: { coordinates: [{ x: 0, y }, { x: width, y }] },
      styles: { color, size: 1, style: line.kind === 'position' ? 'solid' : 'dashed', dashedValue: [6, 4] },
    },
  ];
  // While dragging, the label shows the price the line would move to.
  const title = price === line.price ? line.label : `${line.label}  ${render.formatPrice(price)}`;
  const segments: Array<{ key: string; text: string; background: string }> = [{ key: BODY_KEY, text: title, background: color }];
  if (render.pnlText) segments.push({ key: BODY_KEY, text: render.pnlText, background: pnlColor(line, colors) });
  if (line.removable) segments.push({ key: REMOVE_KEY, text: '×', background: color });
  const widths = segments.map(
    (segment) => utils.calcTextWidth(segment.text, FONT_SIZE, 'normal', colors.fontFamily) + LABEL_PADDING_X * 2,
  );
  let x = width - LABEL_MARGIN - widths.reduce((sum, w) => sum + w, 0) - (segments.length - 1);
  segments.forEach((segment, index) => {
    figures.push({
      key: segment.key,
      type: 'text',
      attrs: { x, y, text: segment.text, align: 'left', baseline: 'middle' },
      styles: labelStyles(segment.background, colors),
    });
    x += (widths[index] as number) + 1;
  });
  return figures;
}

/**
 * The line's price on the axis. A band of the chart's background behind it
 * hides the tick labels it would partly cover; it is drawn with the label, so
 * it follows the line while it is dragged. It leaves the axis line visible.
 */
function axisFigures(render: LineRender, price: number, y: number, width: number, fromZero: boolean): EngineFigure[] {
  const half = LABEL_HEIGHT / 2 + TICK_LABEL_HALF_HEIGHT;
  return [
    {
      type: 'rect',
      ignoreEvent: true,
      attrs: { x: fromZero ? 1 : 0, y: y - half, width: width - 1, height: half * 2 },
      styles: { style: 'fill', color: render.colors.background, borderSize: 0 },
    },
    {
      type: 'text',
      ignoreEvent: true,
      attrs: { x: fromZero ? 0 : width, y, text: render.formatPrice(price), align: fromZero ? 'left' : 'right', baseline: 'middle' },
      styles: { ...labelStyles(lineColor(render.line, render.colors), render.colors), paddingLeft: 4, paddingRight: 4 },
    },
  ];
}

/** Where this line's edge marker goes, or `undefined` while the line is inside the pane. */
function edgePlace(render: LineRender, y: number, height: number, yAxis: AxisLike | null | undefined): EdgeMarkerPlace | undefined {
  if (y >= 0 && y <= height) return undefined;
  if (!yAxis) return { edge: y < 0 ? 'top' : 'bottom', slot: 0 };
  const lines = render.lines().map((line) => ({
    id: line.id,
    y: line.id === render.line.id ? y : yAxis.convertToPixel(line.price),
  }));
  return placeEdgeMarkers(lines, height).get(render.line.id);
}

/** Middle of an edge marker's label. */
function edgeY(place: EdgeMarkerPlace, height: number): number {
  const offset = EDGE_GAP + place.slot * (LABEL_HEIGHT + EDGE_GAP) + LABEL_HEIGHT / 2;
  return place.edge === 'top' ? offset : height - offset;
}

/** A compact tag at the pane's right edge for a line outside the visible prices: an arrow towards it and the line's label. */
function edgeTagFigure(render: LineRender, place: EdgeMarkerPlace, width: number, height: number): EngineFigure {
  const { line, colors } = render;
  const text = `${EDGE_ARROWS[place.edge]} ${line.label}`;
  const textWidth = utils.calcTextWidth(text, FONT_SIZE, 'normal', colors.fontFamily) + LABEL_PADDING_X * 2;
  return {
    type: 'text',
    ignoreEvent: true,
    attrs: { x: width - LABEL_MARGIN - textWidth, y: edgeY(place, height), text, align: 'left', baseline: 'middle' },
    styles: labelStyles(lineColor(line, colors), colors),
  };
}

function markerFigure(render: FillRender, x: number, y: number): EngineFigure {
  const { marker, colors } = render;
  // The tip touches the fill price: buys point up from below, sells point down from above.
  const direction = marker.side === 'buy' ? 1 : -1;
  const baseY = y + direction * MARKER_HEIGHT;
  return {
    type: 'polygon',
    ignoreEvent: true,
    attrs: {
      coordinates: [
        { x, y },
        { x: x - MARKER_HALF_WIDTH, y: baseY },
        { x: x + MARKER_HALF_WIDTH, y: baseY },
      ],
    },
    styles: {
      style: 'stroke_fill',
      color: marker.side === 'buy' ? colors.buy : colors.sell,
      borderColor: colors.background,
      borderSize: 1,
    },
  };
}

let registered = false;

/** Registers the two overlay types with the engine. Runs once. */
export function ensureTradingOverlays(): void {
  if (registered) return;
  registered = true;
  registerOverlay({
    name: LINE_OVERLAY,
    createPointFigures: ({ overlay, coordinates, bounding, yAxis }) => {
      const render = (overlay.extendData as RenderSource<LineRender> | undefined)?.render();
      const y = coordinates[0]?.y;
      const price = overlay.points[0]?.value;
      if (!render || y === undefined || price === undefined) return [];
      const place = edgePlace(render, y, bounding.height, yAxis);
      if (place) return [edgeTagFigure(render, place, bounding.width, bounding.height)];
      return lineFigures(render, price, y, bounding.width);
    },
    createYAxisFigures: ({ overlay, coordinates, bounding, yAxis }) => {
      const render = (overlay.extendData as RenderSource<LineRender> | undefined)?.render();
      const y = coordinates[0]?.y;
      const price = overlay.points[0]?.value;
      if (!render || y === undefined || price === undefined) return [];
      const place = edgePlace(render, y, bounding.height, yAxis);
      const labelY = place ? edgeY(place, bounding.height) : y;
      return axisFigures(render, price, labelY, bounding.width, yAxis?.isFromZero() ?? true);
    },
  });
  registerOverlay({
    name: FILL_OVERLAY,
    createPointFigures: ({ overlay, coordinates }) => {
      const render = (overlay.extendData as RenderSource<FillRender> | undefined)?.render();
      const coordinate = coordinates[0];
      if (!render || !coordinate) return [];
      return [markerFigure(render, coordinate.x, coordinate.y)];
    },
  });
}
