// @vitest-environment happy-dom
import { AckTimeoutError, BrokerSession, MockBroker, type OrderAmendment } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import { afterEach, describe, expect, it } from 'vitest';
import { chartViewInternals, createChartView } from '../chart-view';
import { CANDLE_PANE, type EngineChart } from '../engine';
import { chartThemes } from '../theme';
import { createContainer, flush, settle } from '../test/dom';
import { FILL_OVERLAY, LINE_OVERLAY } from './figures';
import {
  attachTrading,
  type TradingActionErrorEvent,
  type TradingActionEvent,
  type TradingOverlay,
  type TradingOverlayOptions,
} from './overlay';
import type { TradingLine } from './scene';

const ACME = 'MOCK:ACME';
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** A broker that accepts amendments and never applies or confirms them. */
class SilentAmendBroker extends MockBroker {
  override amendOrder(_orderId: string, _changes: OrderAmendment): Promise<void> {
    return Promise.resolve();
  }
}

async function setup(options: { ackTimeoutMs?: number; silentAmend?: boolean; overlay?: TradingOverlayOptions } = {}) {
  const feed = new MockFeed({ autoTick: false });
  const broker = options.silentAmend ? new SilentAmendBroker({ feed }) : new MockBroker({ feed });
  const session = new BrokerSession(broker, { ackTimeoutMs: options.ackTimeoutMs });
  await session.start();
  const view = createChartView(createContainer(), { feed, instrument: ACME, timeframe: '1m', pageSize: 100 });
  const engine = chartViewInternals(view).engine;
  await settle(20);
  const overlay = attachTrading(view, session, options.overlay);
  cleanup.push(
    () => feed.dispose(),
    () => session.stop(),
    () => view.dispose(),
  );
  await feed.setQuote(ACME, { bid: 100, ask: 100.02 });
  const quote = async (bid: number, ask: number) => {
    await feed.setQuote(ACME, { bid, ask });
    await broker.idle();
    await flush();
  };
  const idle = async () => {
    await broker.idle();
    await flush();
  };
  return { feed, broker, session, view, engine, overlay, quote, idle };
}

const lineOf = (overlay: TradingOverlay, kind: TradingLine['kind']) => {
  const line = overlay.scene.value.lines.find((candidate) => candidate.kind === kind);
  if (!line) throw new Error(`No ${kind} line`);
  return line;
};

const overlaysNamed = (engine: EngineChart, name: string) => engine.getOverlays({ name });

const engineOverlay = (engine: EngineChart, lineId: string) => {
  const found = overlaysNamed(engine, LINE_OVERLAY).find((overlay) => overlay.id.endsWith(`:${lineId}`));
  if (!found) throw new Error(`No overlay for ${lineId}`);
  return found;
};

/** Texts and colors the line overlay would draw. */
function drawnTexts(engine: EngineChart, lineId: string) {
  const overlay = engineOverlay(engine, lineId);
  const figures = overlay.createPointFigures?.({
    chart: engine,
    overlay,
    coordinates: [{ x: 0, y: 120 }],
    bounding: { width: 700, height: 400, left: 0, top: 0, right: 0, bottom: 0 },
    xAxis: null,
    yAxis: null,
  });
  return ([] as Array<{ type: string; key?: string; attrs: unknown; styles?: unknown }>)
    .concat(figures ?? [])
    .filter((figure) => figure.type === 'text')
    .map((figure) => ({
      key: figure.key,
      text: (figure.attrs as { text: string }).text,
      background: (figure.styles as { backgroundColor: string }).backgroundColor,
    }));
}

const event = (engine: EngineChart, lineId: string, key = 'body') => {
  const overlay = engineOverlay(engine, lineId);
  return { overlay, chart: engine, figure: { key, type: 'text', attrs: {} } };
};

async function placeBracket(session: BrokerSession, idle: () => Promise<void>) {
  const id = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 10, limitPrice: 99.5, takeProfit: 101, stopLoss: 98.5 });
  await idle();
  return id;
}

describe('attachTrading', () => {
  it('draws orders, exits, positions and fills, and follows them to the take-profit', async () => {
    const { session, engine, overlay, quote, idle } = await setup();
    await placeBracket(session, idle);
    expect(overlay.scene.value.lines.map((line) => line.label)).toEqual(['BUY LMT 10', 'TP 10', 'SL 10']);
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(3);
    expect(drawnTexts(engine, 'order:ord-1').map((text) => text.text)).toEqual(['BUY LMT 10', '×']);
    expect(drawnTexts(engine, 'order:ord-1')[0]?.background).toBe(chartThemes.light.buy);

    await quote(99.4, 99.48);
    const position = lineOf(overlay, 'position');
    expect(overlay.scene.value.lines.map((line) => line.kind)).toEqual(['position', 'take-profit', 'stop-loss']);
    expect(position.pnl?.money).toBe(-1);
    expect(drawnTexts(engine, position.id).map((text) => text.text)).toEqual(['LONG 10', '-1.00 USD', '×']);
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(3);
    expect(overlaysNamed(engine, FILL_OVERLAY)).toHaveLength(1);

    await quote(100.2, 100.22);
    expect(lineOf(overlay, 'position').pnl?.money).toBe(7);
    expect(drawnTexts(engine, position.id)[1]).toMatchObject({ text: '+7.00 USD', background: chartThemes.light.buy });

    await quote(101.02, 101.04);
    expect(overlay.scene.value.lines).toEqual([]);
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(0);
    expect(overlaysNamed(engine, FILL_OVERLAY)).toHaveLength(2);
  });

  it('amends an order when its line is dragged, snapping to the tick and showing the price', async () => {
    const { session, engine, overlay, idle } = await setup();
    const id = await placeBracket(session, idle);
    const actions: TradingActionEvent[] = [];
    overlay.on('action', (action) => actions.push(action));
    const drag = event(engine, `order:${id}`);
    const point = drag.overlay.points[0] as { value: number };

    drag.overlay.onPressedMoveStart?.(drag);
    point.value = 99.1234;
    drag.overlay.onPressedMoving?.(drag);
    expect(point.value).toBe(99.12);
    expect(drawnTexts(engine, `order:${id}`)[0]?.text).toBe('BUY LMT 10  99.12');
    drag.overlay.onPressedMoveEnd?.(drag);
    expect(lineOf(overlay, 'order')).toMatchObject({ price: 99.12, pending: true });
    await idle();

    expect(session.getOrder(id)?.limitPrice).toBe(99.12);
    expect(lineOf(overlay, 'order')).toMatchObject({ price: 99.12, pending: false });
    expect(actions).toEqual([{ lineId: `order:${id}`, action: { type: 'amend-order', orderId: id, changes: { limitPrice: 99.12 } } }]);
  });

  it('ignores drags that start on the cancel button', async () => {
    const { session, engine, overlay, idle } = await setup();
    const id = await placeBracket(session, idle);
    const drag = event(engine, `order:${id}`, 'remove');
    const point = drag.overlay.points[0] as { value: number };
    drag.overlay.onPressedMoveStart?.(drag);
    point.value = 97;
    drag.overlay.onPressedMoving?.(drag);
    expect(point.value).toBe(99.5);
    drag.overlay.onPressedMoveEnd?.(drag);
    await idle();
    expect(session.getOrder(id)?.limitPrice).toBe(99.5);
    expect(lineOf(overlay, 'order').pending).toBe(false);
  });

  it('moves exits on the entry order and on the position', async () => {
    const { session, overlay, quote, idle } = await setup();
    const id = await placeBracket(session, idle);
    await overlay.moveLine(`exit:order:${id}:take-profit`, 102.004);
    await idle();
    expect(session.getOrder(id)?.takeProfit).toBe(102);
    expect(lineOf(overlay, 'take-profit').price).toBe(102);

    await quote(99.4, 99.48);
    const stop = lineOf(overlay, 'stop-loss');
    await overlay.moveLine(stop.id, 97.5);
    await idle();
    expect(session.positions[0]?.stopLoss).toBe(97.5);
    expect(lineOf(overlay, 'stop-loss')).toMatchObject({ price: 97.5, pending: false });
  });

  it('puts a line back and reports the error when the broker rejects', async () => {
    const { session, overlay, idle } = await setup();
    const id = await placeBracket(session, idle);
    const errors: TradingActionErrorEvent[] = [];
    overlay.on('actionError', (error) => errors.push(error));

    await expect(overlay.moveLine(`exit:order:${id}:take-profit`, 99)).rejects.toThrow('Take-profit must be above');
    await flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.action).toEqual({ type: 'amend-order', orderId: id, changes: { takeProfit: 99 } });
    expect(lineOf(overlay, 'take-profit')).toMatchObject({ price: 101, pending: false });
  });

  it('puts a line back when the broker does not confirm in time', async () => {
    const { session, overlay, idle } = await setup({ silentAmend: true, ackTimeoutMs: 40 });
    const id = await placeBracket(session, idle);
    const errors: TradingActionErrorEvent[] = [];
    overlay.on('actionError', (error) => errors.push(error));

    await overlay.moveLine(`order:${id}`, 99.3);
    expect(lineOf(overlay, 'order')).toMatchObject({ price: 99.3, pending: true });
    await settle(80);
    await flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.error).toBeInstanceOf(AckTimeoutError);
    expect(lineOf(overlay, 'order')).toMatchObject({ price: 99.5, pending: false });
  });

  it('cancels orders and closes positions from their buttons', async () => {
    const { session, engine, overlay, quote, idle } = await setup();
    const id = await placeBracket(session, idle);
    const click = event(engine, `order:${id}`, 'remove');
    click.overlay.onClick?.(click);
    expect(lineOf(overlay, 'order').pending).toBe(true);
    await idle();
    expect(session.getOrder(id)?.state).toBe('cancelled');
    expect(overlay.scene.value.lines).toEqual([]);

    await placeBracket(session, idle);
    await quote(99.4, 99.48);
    await overlay.removeLine(lineOf(overlay, 'take-profit').id);
    await idle();
    expect(overlay.scene.value.lines.map((line) => line.kind)).toEqual(['position', 'stop-loss']);

    const position = lineOf(overlay, 'position');
    const close = event(engine, position.id, 'remove');
    close.overlay.onClick?.(close);
    await idle();
    expect(session.positions).toEqual([]);
    expect(overlay.scene.value.lines).toEqual([]);
    expect(overlaysNamed(engine, FILL_OVERLAY)).toHaveLength(2);
  });

  it('toggles orders, positions and fills', async () => {
    const { session, engine, overlay, quote, idle } = await setup();
    await placeBracket(session, idle);
    await quote(99.4, 99.48);
    await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 1, limitPrice: 105 });
    await idle();
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(4);

    overlay.setVisibility({ positions: false });
    expect(overlay.scene.value.lines.map((line) => line.label)).toEqual(['SELL LMT 1']);
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(1);
    overlay.setVisibility({ orders: false, fills: false });
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(0);
    expect(overlaysNamed(engine, FILL_OVERLAY)).toHaveLength(0);
    overlay.setVisibility({ orders: true, positions: true, fills: true });
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(4);
    expect(overlay.visibility.value).toEqual({ orders: true, positions: true, fills: true });
  });

  it('follows the chart instrument and theme', async () => {
    const { session, engine, view, overlay, idle } = await setup();
    const id = await placeBracket(session, idle);
    view.setTheme('dark');
    await flush();
    expect(drawnTexts(engine, `order:${id}`)[0]?.background).toBe(chartThemes.dark.buy);
    expect(drawnTexts(engine, `exit:order:${id}:take-profit`)[0]?.background).toBe(chartThemes.dark.takeProfit);
    expect(drawnTexts(engine, `exit:order:${id}:stop-loss`)[0]?.background).toBe(chartThemes.dark.stopLoss);

    await view.setInstrument('MOCK:ES');
    await flush();
    expect(overlay.scene.value.lines).toEqual([]);
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(0);
    await view.setInstrument(ACME);
    await flush();
    expect(overlay.scene.value.lines).toHaveLength(3);
  });

  it('removes its drawings on dispose, and goes away with the chart', async () => {
    const { session, engine, view, overlay, idle } = await setup();
    await placeBracket(session, idle);
    const second = attachTrading(view, session, { orders: false });
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(3);
    overlay.dispose();
    expect(overlay.disposed).toBe(true);
    expect(overlaysNamed(engine, LINE_OVERLAY)).toHaveLength(0);
    await expect(overlay.moveLine('order:ord-1', 1)).rejects.toThrow('disposed');
    view.dispose();
    expect(second.disposed).toBe(true);
    expect(() => attachTrading(view, session)).toThrow('not created by createChartView');
  });
});

describe('attachTrading: lines outside the bars', () => {
  const priceAxis = (engine: EngineChart) => engine.getYAxes({ paneId: CANDLE_PANE })[0]!;

  /** What the line overlay draws in the pane and on the price axis, with the engine's real axis. */
  function drawnAt(engine: EngineChart, lineId: string, price: number) {
    const overlay = engineOverlay(engine, lineId);
    const yAxis = priceAxis(engine);
    const height = engine.getSize(CANDLE_PANE, 'main')!.height;
    const params = {
      chart: engine,
      overlay,
      coordinates: [{ x: 0, y: yAxis.convertToPixel(price) }],
      bounding: { width: 700, height, left: 0, top: 0, right: 0, bottom: 0 },
      xAxis: null,
      yAxis,
    };
    const texts = (figures: unknown) =>
      ([] as Array<{ type: string; attrs: { text?: string; y?: number } }>)
        .concat((figures ?? []) as never)
        .filter((figure) => figure.type === 'text')
        .map((figure) => ({ text: figure.attrs.text, y: figure.attrs.y }));
    return { height, pane: texts(overlay.createPointFigures?.(params)), axis: texts(overlay.createYAxisFigures?.(params)) };
  }

  it('keeps orders, exits and positions in the autoscaled price range', async () => {
    const { session, engine, view, idle } = await setup();
    const bars = priceAxis(engine).getRange();
    expect(bars.to).toBeLessThan(140);

    await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 1, limitPrice: 140 });
    await idle();
    expect(engine.getAutoscaleValues()).toEqual([140, 140]);
    const range = priceAxis(engine).getRange();
    // The axis keeps its margins around the wider span, so the bottom moves down a little too.
    expect(range.from).toBeLessThanOrEqual(bars.from);
    expect(range.to).toBeGreaterThan(140);
    expect(view.toPixel({ price: 140 }).y).toBeGreaterThan(0);
  });

  it('can leave the lines out of the range, and then marks them at the edge', async () => {
    const { session, engine, overlay, idle } = await setup({ overlay: { autoscaleTradingLines: false } });
    const bars = priceAxis(engine).getRange();
    await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 1, limitPrice: 140 });
    await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 2, limitPrice: 150 });
    await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 3, limitPrice: 60 });
    await idle();
    expect(engine.getAutoscaleValues()).toEqual([]);
    expect(priceAxis(engine).getRange()).toMatchObject({ from: bars.from, to: bars.to });

    const [high, higher, low] = overlay.scene.value.lines.map((line) => line.id) as [string, string, string];
    const top = drawnAt(engine, higher, 150);
    expect(top.pane).toEqual([{ text: '\u25b2 SELL LMT 2', y: 10.5 }]);
    expect(top.axis).toEqual([{ text: '150.00', y: 10.5 }]);
    expect(drawnAt(engine, high, 140).pane).toEqual([{ text: '\u25b2 SELL LMT 1', y: 29.5 }]);
    const bottom = drawnAt(engine, low, 60);
    expect(bottom.pane).toEqual([{ text: '\u25bc BUY LMT 3', y: bottom.height - 10.5 }]);
    expect(bottom.axis).toEqual([{ text: '60.00', y: bottom.height - 10.5 }]);
  });

  it('withdraws its prices from the range when disposed', async () => {
    const { session, engine, overlay, idle } = await setup();
    await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 1, limitPrice: 140 });
    await idle();
    overlay.dispose();
    expect(engine.getAutoscaleValues()).toEqual([]);
  });
});
