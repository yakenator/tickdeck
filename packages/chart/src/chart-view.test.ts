// @vitest-environment happy-dom
import { MockFeed, type BarStreamListener } from '@tickdeck/datafeed';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BarSeriesChange } from './bar-series';
import { chartViewInternals, createChartView, type ChartView, type ChartViewError, type ChartViewOptions } from './chart-view';
import { chartThemes } from './theme';
import { ManualClock, createContainer, settle } from './test/dom';

const MINUTE = 60_000;
const ORIGIN = Date.UTC(2024, 0, 1);

const views: ChartView[] = [];

function setup(options: { minutes?: number; pageSize?: number; timeframe?: string } = {}) {
  const clock = new ManualClock(ORIGIN + (options.minutes ?? 6_000) * MINUTE + 30_000);
  const feed = new MockFeed({ autoTick: false, scheduler: clock, historyStart: ORIGIN });
  const history = vi.spyOn(feed, 'loadHistory');
  const container = createContainer();
  const view = createChartView(container, {
    feed,
    instrument: 'ACME',
    timeframe: options.timeframe ?? '1m',
    pageSize: options.pageSize ?? 100,
    scheduler: clock,
  });
  views.push(view);
  const engine = chartViewInternals(view).engine;
  return { clock, feed, history, container, view, engine };
}

afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
});

describe('createChartView: data', () => {
  it('resolves the instrument and loads the newest page into the engine', async () => {
    const { view, engine, history } = setup();
    expect(view.loading.value).toBe(true);
    await settle(20);

    expect(view.instrument.value).toBe('MOCK:ACME');
    expect(view.instrumentInfo.value?.name).toBe('ACME');
    expect(view.loading.value).toBe(false);
    expect(view.bars).toHaveLength(100);
    expect(engine.getDataList().map((bar) => bar.timestamp)).toEqual(view.bars.map((bar) => bar.time));
    expect(history.mock.calls[0]?.[0]).toMatchObject({ instrument: 'MOCK:ACME', timeframe: '1m', count: 100, firstPage: true });
    expect(engine.getSymbol()).toMatchObject({ ticker: 'ACME', pricePrecision: 2 });
  });

  it('pages older history in when scrolled to the left edge', async () => {
    const { view, engine, history } = setup();
    await settle(20);
    const oldest = view.bars[0]?.time as number;

    engine.scrollByDistance(3_000);
    await settle(20);

    expect(history).toHaveBeenCalledTimes(2);
    expect(history.mock.calls[1]?.[0]).toMatchObject({ to: oldest, firstPage: false });
    expect(view.bars).toHaveLength(200);
    expect(view.bars[99]?.time).toBe(oldest - MINUTE);
    expect(engine.getDataList()).toHaveLength(200);
    expect(engine.getDataList()[0]?.timestamp).toBe(view.bars[0]?.time);
  });

  it('stops paging at the end of history', async () => {
    const { view, engine, history } = setup({ minutes: 130 });
    await settle(20);
    engine.scrollByDistance(3_000);
    await settle(20);
    expect(view.bars[0]?.time).toBe(ORIGIN);
    expect(view.bars).toHaveLength(131);
    expect(view.endOfHistory).toBe(true);

    engine.scrollByDistance(3_000);
    await settle(20);
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('fills the screen when the first page is short', async () => {
    const { view, history } = setup({ pageSize: 20 });
    await settle(30);
    expect(history.mock.calls.length).toBeGreaterThan(2);
    expect(view.bars.length).toBeGreaterThanOrEqual(60);
  });

  it('streams realtime bars into the engine', async () => {
    const { view, engine, clock, feed } = setup();
    await settle(20);
    const changes: BarSeriesChange['kind'][] = [];
    view.on('bars', (change) => changes.push(change.kind));
    const last = view.bars.at(-1)?.time as number;

    clock.advance(10_000);
    await feed.tick();
    clock.advance(MINUTE);
    await feed.tick();

    expect(changes).toEqual(['update', 'update', 'append']);
    expect(view.bars.at(-1)?.time).toBe(last + MINUTE);
    expect(engine.getDataList().at(-1)?.timestamp).toBe(last + MINUTE);
    expect(engine.getDataList().at(-1)?.close).toBe(view.bars.at(-1)?.close);
  });

  it('reloads everything when the feed reports changed history', async () => {
    const { feed, view, history } = setup();
    const listeners: BarStreamListener[] = [];
    const stream = feed.streamBars.bind(feed);
    vi.spyOn(feed, 'streamBars').mockImplementation((request, listener) => {
      listeners.push(listener);
      return stream(request, listener);
    });
    await settle(20);
    const resets: number[] = [];
    view.on('bars', (change) => {
      if (change.kind === 'reset') resets.push(change.bars.length);
    });

    listeners.at(-1)?.onHistoryChanged?.();
    await settle(20);

    expect(history).toHaveBeenCalledTimes(2);
    expect(history.mock.calls[1]?.[0]).toMatchObject({ firstPage: true });
    expect(resets).toEqual([100]);
    expect(listeners).toHaveLength(2);
  });

  it('switches timeframe and instrument, ignoring answers for earlier choices', async () => {
    const { feed, view, engine, history } = setup();
    await settle(20);

    view.setTimeframe('5m');
    await settle(20);
    expect(view.timeframe.value).toBe('5m');
    expect(history.mock.calls.at(-1)?.[0]).toMatchObject({ timeframe: '5m', firstPage: true });
    expect(view.bars.every((bar) => bar.time % (5 * MINUTE) === 0)).toBe(true);
    expect(engine.getPeriod()).toEqual({ type: 'minute', span: 5 });
    expect(engine.getStyles().candle.tooltip.title.template).toBe('{ticker} \u00b7 5m');
    expect(() => view.setTimeframe('5x')).toThrow(RangeError);

    const resolve = feed.getInstrument.bind(feed);
    let releaseBtc: () => void = () => {};
    vi.spyOn(feed, 'getInstrument').mockImplementation(async (id) => {
      if (id === 'MOCK:BTCUSD') await new Promise<void>((done) => (releaseBtc = done));
      return resolve(id);
    });
    const btc = view.setInstrument('MOCK:BTCUSD');
    const es = view.setInstrument('MOCK:ES');
    await es;
    releaseBtc();
    await btc;
    await settle(20);

    expect(view.instrument.value).toBe('MOCK:ES');
    expect(view.instrumentInfo.value?.id).toBe('MOCK:ES');
    expect(view.bars.at(-1)?.close).toBeGreaterThan(1_000);
    expect(history.mock.calls.some((call) => call[0].instrument === 'MOCK:BTCUSD')).toBe(false);
  });

  it('reports failures and keeps working', async () => {
    const { view, history } = setup();
    const errors: ChartViewError[] = [];
    view.on('error', (error) => errors.push(error));
    await settle(20);

    const switching = view.setInstrument('NOPE');
    expect(view.instrument.value).toBe('NOPE');
    await expect(switching).rejects.toThrow('Unknown instrument');
    expect(view.instrument.value).toBe('MOCK:ACME');
    expect(errors.map((error) => error.operation)).toEqual(['instrument']);
    expect(view.loading.value).toBe(false);

    history.mockRejectedValueOnce(new Error('offline'));
    view.reload();
    await settle(20);
    expect(errors.map((error) => error.operation)).toEqual(['instrument', 'history']);
    expect(view.bars).toHaveLength(0);

    view.reload();
    await settle(20);
    expect(view.bars).toHaveLength(100);
  });
});

describe('createChartView: presentation', () => {
  it('maps chart styles to the engine with flat fills only', async () => {
    const { view, engine } = setup();
    await settle(20);
    const candle = () => engine.getStyles().candle;
    expect(candle().type).toBe('candle_solid');

    view.setChartStyle('bars');
    expect(candle().type).toBe('ohlc');
    view.setChartStyle('line');
    expect(candle().type).toBe('area');
    expect(candle().area.backgroundColor).toBe('transparent');
    view.setChartStyle('area');
    expect(candle().area.backgroundColor).toBe(chartThemes.light.areaFill);
    expect(typeof candle().area.backgroundColor).toBe('string');
    expect(view.chartStyle.value).toBe('area');
    // The fake canvas throws on gradients; drawing the area style must not hit one.
    await settle(40);
    expect(() => view.setChartStyle('ribbon' as never)).toThrow(RangeError);
  });

  it('switches the price scale mode', async () => {
    const { view, engine } = setup();
    await settle(20);
    const axis = () => engine.getYAxes({ paneId: 'candle_pane' })[0];
    view.setPriceScaleMode('log');
    expect(axis()?.name).toBe('logarithm');
    view.setPriceScaleMode('percent');
    expect(axis()?.name).toBe('percentage');
    view.setPriceScaleMode('indexed');
    await settle(20);
    expect(axis()?.name).toBe('tdkIndexed');
    const range = axis()?.getRange();
    expect(range?.displayFrom).toBeLessThan(100.5);
    expect(range?.displayTo).toBeGreaterThan(99.5);
    view.setPriceScaleMode('normal');
    expect(axis()?.name).toBe('normal');
    expect(view.priceScaleMode.value).toBe('normal');
  });

  it('applies themes, CSS tokens and overrides', async () => {
    const { view, engine, container } = setup();
    view.setTheme('dark');
    expect(view.theme.value).toBe('dark');
    expect(view.colors.value.background).toBe(chartThemes.dark.background);
    expect(engine.getDom()?.style.backgroundColor).toBeTruthy();
    expect(engine.getStyles().candle.bar.upColor).toBe(chartThemes.dark.up);

    container.style.setProperty('--tdk-color-buy', '#00aa00');
    container.style.setProperty('--tdk-color-accent', '#336699');
    view.setTheme('light', { stopLoss: '#ff0000' });
    expect(view.colors.value).toMatchObject({ buy: '#00aa00', up: '#00aa00', line: '#336699', stopLoss: '#ff0000' });
    expect(view.colors.value.areaFill).toBe('rgba(51, 102, 153, 0.16)');
    expect(engine.getStyles().candle.bar.upColor).toBe('#00aa00');
  });

  it('tracks the crosshair price and time', async () => {
    const { view, engine, container } = setup();
    await settle(20);
    const store = (engine as unknown as { getChartStore(): { setCrosshair(c: object): void } }).getChartStore();
    store.setCrosshair({ x: 400, y: 200, paneId: 'candle_pane' });
    const crosshair = view.crosshair.value;
    expect(crosshair?.bar).toBeDefined();
    expect(crosshair?.time).toBe(crosshair?.bar?.time);
    expect(crosshair?.price).toBe(view.snapPrice(crosshair?.price as number));
    expect(view.formatPrice(crosshair?.price as number)).toMatch(/^\d+\.\d\d$/);

    container.dispatchEvent(new Event('pointerleave'));
    expect(view.crosshair.value).toBeUndefined();
  });

  it('converts between prices, times and pixels', async () => {
    const { view } = setup();
    await settle(20);
    const bar = view.bars[80];
    const pixel = view.toPixel({ time: bar?.time, price: bar?.close });
    expect(pixel.x).toBeGreaterThan(0);
    expect(pixel.y).toBeGreaterThan(0);
    const point = view.fromPixel(pixel);
    expect(point.time).toBe(bar?.time);
    expect(point.price).toBeCloseTo(bar?.close as number, 1);
    expect(view.toPixel({})).toEqual({ x: undefined, y: undefined });
  });

  it('gives a snapshot of its state', async () => {
    const { view } = setup();
    await settle(20);
    const state = view.getState();
    expect(state).toMatchObject({ instrument: 'MOCK:ACME', timeframe: '1m', style: 'candles', priceScaleMode: 'normal' });
    expect(state.bars).toHaveLength(100);
    expect(state.bars).not.toBe(view.bars);
  });

  it('cleans up on dispose', async () => {
    const { view, container, feed, clock } = setup();
    await settle(20);
    const changes: string[] = [];
    view.on('bars', (change) => changes.push(change.kind));
    view.dispose();
    expect(container.children).toHaveLength(0);
    expect(container.hasAttribute('data-tdk-chart-id')).toBe(false);
    expect(view.disposed).toBe(true);
    expect(() => view.setTimeframe('5m')).toThrow('disposed');
    expect(() => chartViewInternals(view)).toThrow();
    clock.advance(MINUTE);
    await feed.tick();
    expect(changes).toEqual([]);

    const again = createChartView(container, { feed, instrument: 'MOCK:ES', timeframe: '1m' });
    views.push(again);
    expect(() => createChartView(container, { feed, instrument: 'MOCK:ES', timeframe: '1m' })).toThrow('already holds a chart');
  });

  it('rejects bad options up front', () => {
    const feed = new MockFeed({ autoTick: false });
    const create = (options: Partial<ChartViewOptions>) =>
      createChartView(createContainer(), { feed, instrument: 'MOCK:ES', timeframe: '1m', ...options });
    expect(() => create({ timeframe: 'soon' })).toThrow(RangeError);
    expect(() => create({ style: 'ribbon' as never })).toThrow(RangeError);
    expect(() => create({ priceScaleMode: 'square' as never })).toThrow(RangeError);
    expect(() => create({ theme: 'sepia' as never })).toThrow(RangeError);
  });
});

describe('createChartView: keyboard and accessibility', () => {
  it('is focusable in document order and named after what it shows', async () => {
    const { view, container } = setup();
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('tabindex')).toBe('0');
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe('ACME, 1m chart');

    await settle(20);
    view.setTimeframe('5m');
    expect(root.getAttribute('aria-label')).toBe('ACME, 5m chart');
    await view.setInstrument('MOCK:ES');
    expect(root.getAttribute('aria-label')).toBe('ES, 5m chart');
  });

  it('handles its shortcuts, but not keys typed into fields inside shadow roots', async () => {
    setup();
    await settle(20);
    const host = document.createElement('div');
    document.body.append(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(input);
    /** Shift+ArrowLeft as browsers deliver it: outside the shadow root the target is the host, the path starts at `origin`. */
    const press = (origin: Element) => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true, bubbles: true, composed: true, cancelable: true });
      Object.defineProperty(event, 'composedPath', { value: () => [origin, host, document.body, document] });
      host.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(press(host)).toBe(true);
    expect(press(input)).toBe(false);
    host.remove();
  });
});
