import { dispose as disposeEngine, init as initEngine } from '@tickdeck/chart-engine';
import {
  Emitter,
  ObservableValue,
  decimalPlaces,
  type Bar,
  type Instrument,
  type Listener,
  type ReadonlyObservableValue,
  type Scheduler,
  type Unsubscribe,
} from '@tickdeck/core';
import { tryParseTimeframe, type MarketFeed } from '@tickdeck/datafeed';
import { BarSeries, type BarSeriesChange } from './bar-series';
import {
  AXIS_NAMES,
  CANDLE_PANE,
  engineStyles,
  enginePeriod,
  ensureEngineExtensions,
  toEngineBar,
  type EngineBar,
  type EngineChart,
} from './engine';
import { formatPrice, priceDecimals, snapPrice } from './price';
import { readChartColorTokens, resolveChartColors, type ChartColors, type ChartThemeName } from './theme';
import type { ChartCrosshair, ChartState, ChartStyle, PriceScaleMode } from './types';

export interface ChartViewOptions {
  /** Where bars and instrument metadata come from. */
  feed: MarketFeed;
  /** Instrument id to show, resolved through `feed.getInstrument`. */
  instrument: string;
  /** Timeframe such as `5m` or `1D` (see `parseTimeframe`). */
  timeframe: string;
  /** Default `candles`. */
  style?: ChartStyle;
  /** Default `normal`. */
  priceScaleMode?: PriceScaleMode;
  /** Default `light`. */
  theme?: ChartThemeName;
  /** Colors applied over the theme and the container's `--tdk-*` tokens. */
  colors?: Partial<ChartColors>;
  /** Bars asked for per history page. Default 500. */
  pageSize?: number;
  /** IANA timezone of the time axis. Default: the browser's. */
  timezone?: string;
  /** Clock for history requests. Default: the host's. */
  scheduler?: Scheduler;
}

/** A feed request that failed. The chart keeps what it had. */
export interface ChartViewError {
  operation: 'instrument' | 'history' | 'older-history';
  error: unknown;
}

export interface ChartViewEvents {
  /** Bars were loaded or updated. */
  bars: BarSeriesChange;
  error: ChartViewError;
}

/**
 * A chart in a DOM element: one instrument and timeframe from a
 * `MarketFeed`, with history paged in as the user scrolls left and realtime
 * bars streamed in. Create one with {@link createChartView}.
 */
export interface ChartView {
  readonly container: HTMLElement;
  readonly feed: MarketFeed;
  /** Id of the instrument shown: the requested id while the feed resolves it, the previous one again if that fails. */
  readonly instrument: ReadonlyObservableValue<string>;
  /** Metadata of the instrument shown, once the feed has resolved it. */
  readonly instrumentInfo: ReadonlyObservableValue<Instrument | undefined>;
  readonly timeframe: ReadonlyObservableValue<string>;
  readonly chartStyle: ReadonlyObservableValue<ChartStyle>;
  readonly priceScaleMode: ReadonlyObservableValue<PriceScaleMode>;
  readonly theme: ReadonlyObservableValue<ChartThemeName>;
  /** The colors in use: the theme, the container's `--tdk-*` tokens, then overrides. */
  readonly colors: ReadonlyObservableValue<ChartColors>;
  /** True while the instrument or a page of history is loading. */
  readonly loading: ReadonlyObservableValue<boolean>;
  /** The pointer's time and price, or `undefined` when the pointer is not over the chart. */
  readonly crosshair: ReadonlyObservableValue<ChartCrosshair | undefined>;
  /** Loaded bars, oldest first. */
  readonly bars: readonly Bar[];
  /** No bars exist before the oldest loaded bar. */
  readonly endOfHistory: boolean;
  readonly disposed: boolean;

  on<K extends keyof ChartViewEvents>(event: K, listener: Listener<ChartViewEvents[K]>): Unsubscribe;
  /**
   * Shows another instrument. Resolves once the feed returned its metadata
   * (history keeps loading afterwards). On failure it rejects and also emits `error`.
   */
  setInstrument(instrument: string): Promise<void>;
  /** @throws RangeError for an invalid timeframe. */
  setTimeframe(timeframe: string): void;
  setChartStyle(style: ChartStyle): void;
  setPriceScaleMode(mode: PriceScaleMode): void;
  /**
   * Switches between the built-in light and dark colors. `--tdk-*` tokens on
   * the container still take precedence, and are read again. `colors`
   * replaces the overrides given before; omit it to keep them.
   */
  setTheme(theme: ChartThemeName, colors?: Partial<ChartColors>): void;
  /** Formats a price with the instrument's precision. */
  formatPrice(price: number): string;
  /** Rounds a price to the instrument's tick size (unchanged until the instrument is known). */
  snapPrice(price: number): number;
  /** Pixel position of a time and price, relative to the container's top-left corner. */
  toPixel(point: { time?: number; price?: number }): { x?: number; y?: number };
  /** Time (bar open time) and price at a pixel position relative to the container's top-left corner. */
  fromPixel(pixel: { x?: number; y?: number }): { time?: number; price?: number };
  /** Drops the loaded bars and loads them again. */
  reload(): void;
  /** Lays the chart out again. The chart already follows its container's size on its own. */
  resize(): void;
  /** Scrolls back to the newest bar. */
  scrollToRealtime(): void;
  getState(): ChartState;
  dispose(): void;
}

/** Package-internal access for the trading overlay. */
export interface ChartViewInternals {
  readonly engine: EngineChart;
  onDispose(callback: () => void): Unsubscribe;
}

const internals = new WeakMap<ChartView, ChartViewInternals>();

export function chartViewInternals(view: ChartView): ChartViewInternals {
  const found = internals.get(view);
  if (!found) throw new TypeError('The chart view was not created by createChartView or is disposed');
  return found;
}

const CHART_STYLES: readonly ChartStyle[] = ['candles', 'bars', 'line', 'area'];
const SCALE_MODES: readonly PriceScaleMode[] = ['normal', 'log', 'percent', 'indexed'];
const THEMES: readonly ChartThemeName[] = ['light', 'dark'];

function sameCrosshair(a: ChartCrosshair | undefined, b: ChartCrosshair | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.time === b.time && a.price === b.price && a.bar === b.bar;
}

function sameColors(a: ChartColors, b: ChartColors): boolean {
  return (Object.keys(a) as (keyof ChartColors)[]).every((key) => a[key] === b[key]);
}

function findBar(bars: readonly Bar[], time: number): Bar | undefined {
  let low = 0;
  let high = bars.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const bar = bars[middle] as Bar;
    if (bar.time === time) return bar;
    if (bar.time < time) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

class ChartViewImpl implements ChartView {
  readonly container: HTMLElement;
  readonly feed: MarketFeed;
  readonly instrument: ReadonlyObservableValue<string>;
  readonly instrumentInfo: ReadonlyObservableValue<Instrument | undefined>;
  readonly timeframe: ReadonlyObservableValue<string>;
  readonly chartStyle: ReadonlyObservableValue<ChartStyle>;
  readonly priceScaleMode: ReadonlyObservableValue<PriceScaleMode>;
  readonly theme: ReadonlyObservableValue<ChartThemeName>;
  readonly colors: ReadonlyObservableValue<ChartColors>;
  readonly loading: ReadonlyObservableValue<boolean>;
  readonly crosshair: ReadonlyObservableValue<ChartCrosshair | undefined>;

  readonly #events = new Emitter<ChartViewEvents>();
  readonly #engine: EngineChart;
  readonly #instrument: ObservableValue<string>;
  readonly #instrumentInfo = new ObservableValue<Instrument | undefined>(undefined);
  readonly #timeframe: ObservableValue<string>;
  readonly #chartStyle: ObservableValue<ChartStyle>;
  readonly #priceScaleMode: ObservableValue<PriceScaleMode>;
  readonly #theme: ObservableValue<ChartThemeName>;
  readonly #colors: ObservableValue<ChartColors>;
  readonly #loading = new ObservableValue(false);
  readonly #crosshair = new ObservableValue<ChartCrosshair | undefined>(undefined, { equals: sameCrosshair });
  readonly #pageSize: number | undefined;
  readonly #scheduler: Scheduler | undefined;
  readonly #disposeCallbacks = new Set<() => void>();
  #colorOverrides: Partial<ChartColors>;
  #series: BarSeries | undefined;
  #seriesListeners: Unsubscribe[] = [];
  #realtime: ((bar: EngineBar) => void) | undefined;
  #instrumentRequest = 0;
  #resolvingInstrument = false;
  #historyRequests = 0;
  #disposed = false;

  constructor(container: HTMLElement, options: ChartViewOptions) {
    if (!tryParseTimeframe(options.timeframe)) throw new RangeError(`Invalid timeframe "${options.timeframe}"`);
    if (container.hasAttribute('data-tdk-chart-id')) throw new Error('The container already holds a chart');
    ensureEngineExtensions();
    this.container = container;
    this.feed = options.feed;
    this.#pageSize = options.pageSize;
    this.#scheduler = options.scheduler;
    this.#colorOverrides = { ...options.colors };
    this.#instrument = new ObservableValue(options.instrument);
    this.#timeframe = new ObservableValue(options.timeframe);
    this.#chartStyle = new ObservableValue(checked(options.style ?? 'candles', CHART_STYLES, 'chart style'));
    this.#priceScaleMode = new ObservableValue(checked(options.priceScaleMode ?? 'normal', SCALE_MODES, 'price scale mode'));
    this.#theme = new ObservableValue(checked(options.theme ?? 'light', THEMES, 'theme'));
    this.#colors = new ObservableValue(this.#resolveColors(), { equals: sameColors });

    this.instrument = this.#instrument.asReadonly();
    this.instrumentInfo = this.#instrumentInfo.asReadonly();
    this.timeframe = this.#timeframe.asReadonly();
    this.chartStyle = this.#chartStyle.asReadonly();
    this.priceScaleMode = this.#priceScaleMode.asReadonly();
    this.theme = this.#theme.asReadonly();
    this.colors = this.#colors.asReadonly();
    this.loading = this.#loading.asReadonly();
    this.crosshair = this.#crosshair.asReadonly();

    const engine = initEngine(container, {
      styles: engineStyles(this.#colors.value, this.#chartStyle.value),
      timezone: options.timezone,
    });
    if (!engine) throw new Error('The chart engine could not be created');
    this.#engine = engine;
    this.#paintBackground();
    // The engine's root takes keyboard focus (Shift+arrows scroll, Shift+plus and minus zoom); it is named after what it shows.
    const root = engine.getDom();
    root?.setAttribute('role', 'img');
    root?.addEventListener('focus', this.#onFocus);
    root?.addEventListener('blur', this.#onBlur);
    if (this.#priceScaleMode.value !== 'normal') {
      engine.overrideYAxis({ paneId: CANDLE_PANE, name: AXIS_NAMES[this.#priceScaleMode.value] });
    }
    engine.setPeriod(enginePeriod(options.timeframe));
    this.#applyTitle();
    engine.setDataLoader({
      getBars: ({ type, callback }) => this.#getBars(type, callback),
      subscribeBar: ({ callback }) => {
        this.#realtime = callback;
      },
      unsubscribeBar: () => {
        this.#realtime = undefined;
      },
    });
    engine.subscribeAction('onCrosshairChange', this.#onCrosshair);
    container.addEventListener('pointerleave', this.#onPointerLeave);
    internals.set(this, {
      engine,
      onDispose: (callback) => {
        this.#disposeCallbacks.add(callback);
        return () => this.#disposeCallbacks.delete(callback);
      },
    });
    this.#selectInstrument(options.instrument).catch(() => {});
  }

  get bars(): readonly Bar[] {
    return this.#series?.bars ?? [];
  }

  get endOfHistory(): boolean {
    return this.#series?.endOfHistory ?? false;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  on<K extends keyof ChartViewEvents>(event: K, listener: Listener<ChartViewEvents[K]>): Unsubscribe {
    return this.#events.on(event, listener);
  }

  setInstrument(instrument: string): Promise<void> {
    this.#assertLive();
    if (instrument === this.#instrumentInfo.value?.id && !this.#resolvingInstrument) return Promise.resolve();
    return this.#selectInstrument(instrument);
  }

  setTimeframe(timeframe: string): void {
    this.#assertLive();
    if (!tryParseTimeframe(timeframe)) throw new RangeError(`Invalid timeframe "${timeframe}"`);
    if (timeframe === this.#timeframe.value) return;
    this.#timeframe.set(timeframe);
    const info = this.#instrumentInfo.value;
    if (info) this.#replaceSeries(info.id, timeframe);
    this.#engine.setPeriod(enginePeriod(timeframe));
    this.#applyTitle();
  }

  setChartStyle(style: ChartStyle): void {
    this.#assertLive();
    this.#chartStyle.set(checked(style, CHART_STYLES, 'chart style'));
    this.#engine.setStyles(engineStyles(this.#colors.value, style));
  }

  setPriceScaleMode(mode: PriceScaleMode): void {
    this.#assertLive();
    if (checked(mode, SCALE_MODES, 'price scale mode') === this.#priceScaleMode.value) return;
    this.#priceScaleMode.set(mode);
    this.#engine.overrideYAxis({ paneId: CANDLE_PANE, name: AXIS_NAMES[mode] });
  }

  setTheme(theme: ChartThemeName, colors?: Partial<ChartColors>): void {
    this.#assertLive();
    checked(theme, THEMES, 'theme');
    if (colors) this.#colorOverrides = { ...colors };
    this.#theme.set(theme);
    this.#colors.set(this.#resolveColors());
    this.#engine.setStyles(engineStyles(this.#colors.value, this.#chartStyle.value));
    this.#paintBackground();
  }

  formatPrice(price: number): string {
    const info = this.#instrumentInfo.value;
    return info ? formatPrice(price, info) : String(price);
  }

  snapPrice(price: number): number {
    const info = this.#instrumentInfo.value;
    return info ? snapPrice(price, info.tickSize) : price;
  }

  toPixel(point: { time?: number; price?: number }): { x?: number; y?: number } {
    this.#assertLive();
    const [pixel] = this.#engine.convertToPixel([{ timestamp: point.time, value: point.price }], {
      paneId: CANDLE_PANE,
      absolute: true,
    }) as Array<{ x?: number; y?: number }>;
    return { x: pixel?.x, y: pixel?.y };
  }

  fromPixel(pixel: { x?: number; y?: number }): { time?: number; price?: number } {
    this.#assertLive();
    const [point] = this.#engine.convertFromPixel([pixel], { paneId: CANDLE_PANE, absolute: true }) as Array<{
      timestamp?: number;
      value?: number;
    }>;
    return { time: point?.timestamp, price: point?.value };
  }

  reload(): void {
    this.#assertLive();
    const info = this.#instrumentInfo.value;
    if (!info) return;
    this.#replaceSeries(info.id, this.#timeframe.value);
    this.#engine.resetData();
  }

  resize(): void {
    this.#assertLive();
    this.#engine.resize();
  }

  scrollToRealtime(): void {
    this.#assertLive();
    this.#engine.scrollToRealTime();
  }

  getState(): ChartState {
    return {
      instrument: this.#instrument.value,
      timeframe: this.#timeframe.value,
      style: this.#chartStyle.value,
      priceScaleMode: this.#priceScaleMode.value,
      bars: [...this.bars],
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const callback of [...this.#disposeCallbacks]) callback();
    this.#disposeCallbacks.clear();
    this.#disposed = true;
    this.#instrumentRequest++;
    this.#dropSeries();
    this.#realtime = undefined;
    this.container.removeEventListener('pointerleave', this.#onPointerLeave);
    const root = this.#engine.getDom();
    root?.removeEventListener('focus', this.#onFocus);
    root?.removeEventListener('blur', this.#onBlur);
    this.#engine.unsubscribeAction('onCrosshairChange', this.#onCrosshair);
    disposeEngine(this.#engine);
    this.container.removeAttribute('data-tdk-chart-id');
    internals.delete(this);
    this.#loading.set(false);
    this.#crosshair.set(undefined);
    this.#events.removeAllListeners();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('The chart view is disposed');
  }

  #resolveColors(): ChartColors {
    return resolveChartColors(this.#theme.value, readChartColorTokens(this.container), this.#colorOverrides);
  }

  /** The legend title: the instrument's name and the timeframe as tickdeck writes it. */
  #applyTitle(): void {
    this.#engine.setStyles({ candle: { tooltip: { title: { template: `{ticker} \u00b7 ${this.#timeframe.value}` } } } });
    this.#applyLabel();
  }

  /** The accessible name of the chart: instrument and timeframe, such as `ACME, 1m chart`. */
  #applyLabel(): void {
    const name = this.#instrumentInfo.value?.name ?? this.#instrument.value;
    this.#engine.getDom()?.setAttribute('aria-label', `${name}, ${this.#timeframe.value} chart`);
  }

  #paintBackground(): void {
    const root = this.#engine.getDom();
    if (root) root.style.backgroundColor = this.#colors.value.background;
  }

  async #selectInstrument(id: string): Promise<void> {
    const request = ++this.#instrumentRequest;
    this.#instrument.set(id);
    this.#resolvingInstrument = true;
    this.#updateLoading();
    let info: Instrument;
    try {
      info = await this.feed.getInstrument(id);
    } catch (error) {
      if (request === this.#instrumentRequest) {
        this.#resolvingInstrument = false;
        // The chart still shows the previous instrument, if any.
        this.#instrument.set(this.#instrumentInfo.value?.id ?? id);
        this.#updateLoading();
        this.#events.emit('error', { operation: 'instrument', error });
      }
      throw error;
    }
    if (request !== this.#instrumentRequest) return;
    this.#resolvingInstrument = false;
    this.#instrument.set(info.id);
    this.#instrumentInfo.set(info);
    this.#replaceSeries(info.id, this.#timeframe.value);
    this.#engine.setSymbol({
      ticker: info.name,
      pricePrecision: priceDecimals(info),
      volumePrecision: decimalPlaces(info.quantity.step),
    });
    this.#applyLabel();
    this.#updateLoading();
  }

  #replaceSeries(instrument: string, timeframe: string): void {
    this.#dropSeries();
    const series = new BarSeries(this.feed, { instrument, timeframe }, { pageSize: this.#pageSize, scheduler: this.#scheduler });
    this.#series = series;
    this.#seriesListeners = [
      series.on('change', (change) => this.#onSeriesChange(series, change)),
      series.on('historyChanged', () => {
        if (series === this.#series) this.reload();
      }),
    ];
    this.#crosshair.set(undefined);
  }

  #dropSeries(): void {
    for (const unsubscribe of this.#seriesListeners) unsubscribe();
    this.#seriesListeners = [];
    this.#series?.dispose();
    this.#series = undefined;
  }

  #onSeriesChange(series: BarSeries, change: BarSeriesChange): void {
    if (series !== this.#series) return;
    if (change.kind === 'update' || change.kind === 'append') this.#realtime?.(toEngineBar(change.bar));
    this.#events.emit('bars', change);
  }

  #getBars(type: string, callback: (bars: EngineBar[], more?: { forward?: boolean; backward?: boolean }) => void): void {
    const series = this.#series;
    if (!series) {
      callback([], { forward: false, backward: false });
      return;
    }
    const current = () => series === this.#series;
    if (type === 'init') {
      this.#track(series.loadInitial()).then(
        () => {
          if (current()) callback(series.bars.map(toEngineBar), { forward: !series.endOfHistory, backward: false });
        },
        (error: unknown) => {
          if (!current()) return;
          this.#events.emit('error', { operation: 'history', error });
          callback([], { forward: false, backward: false });
        },
      );
    } else if (type === 'forward') {
      this.#track(series.loadOlder()).then(
        (older) => {
          if (current()) callback(older.map(toEngineBar), { forward: !series.endOfHistory, backward: false });
        },
        (error: unknown) => {
          if (!current()) return;
          this.#events.emit('error', { operation: 'older-history', error });
          // Leave paging on, so the next scroll to the left edge retries.
          callback([], { forward: true, backward: false });
        },
      );
    } else {
      // Pages newer than the newest bar do not exist; realtime bars arrive through the stream.
      callback([], { forward: !series.endOfHistory, backward: false });
    }
  }

  #track<T>(request: Promise<T>): Promise<T> {
    this.#historyRequests++;
    this.#updateLoading();
    const done = () => {
      this.#historyRequests--;
      this.#updateLoading();
    };
    request.then(done, done);
    return request;
  }

  #updateLoading(): void {
    this.#loading.set(!this.#disposed && (this.#resolvingInstrument || this.#historyRequests > 0));
  }

  readonly #onCrosshair = (data?: unknown): void => {
    const event = data as { x?: number; y?: number; paneId?: string } | undefined;
    if (!event || event.x === undefined || event.paneId === undefined) {
      this.#crosshair.set(undefined);
      return;
    }
    const [point] = this.#engine.convertFromPixel([{ x: event.x, y: event.y }], { paneId: event.paneId }) as Array<{
      timestamp?: number;
      value?: number;
    }>;
    const info = this.#instrumentInfo.value;
    const value = point?.value;
    const price =
      event.paneId === CANDLE_PANE && info && value !== undefined && Number.isFinite(value)
        ? snapPrice(value, info.tickSize)
        : undefined;
    const time = point?.timestamp;
    this.#crosshair.set({ time, price, bar: time === undefined ? undefined : findBar(this.bars, time) });
  };

  readonly #onPointerLeave = (): void => {
    this.#crosshair.set(undefined);
  };

  /** The engine hides the focus outline; keyboard focus gets one in the accent color. */
  readonly #onFocus = (event: FocusEvent): void => {
    const root = event.currentTarget as HTMLElement;
    let keyboard = true;
    try {
      keyboard = root.matches(':focus-visible');
    } catch {
      // Without `:focus-visible` support every focus shows the outline.
    }
    if (!keyboard) return;
    root.style.outline = `2px solid ${this.#colors.value.line}`;
    root.style.outlineOffset = '-2px';
  };

  readonly #onBlur = (event: FocusEvent): void => {
    (event.currentTarget as HTMLElement).style.outline = 'none';
  };
}

function checked<T extends string>(value: T, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value)) throw new RangeError(`Unknown ${what} "${value}"`);
  return value;
}

/**
 * Creates a chart inside `container`, which must have a size (the chart
 * fills it and follows its size). The instrument is resolved through the
 * feed, then history loads and realtime bars stream in.
 *
 * @throws RangeError for an invalid timeframe, style or price scale mode.
 */
export function createChartView(container: HTMLElement, options: ChartViewOptions): ChartView {
  return new ChartViewImpl(container, options);
}
