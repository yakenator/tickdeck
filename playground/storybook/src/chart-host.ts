// <playground-chart>: createChartView and attachTrading in an element that
// fills the box its layout gives it, created when it is attached and disposed
// when it is removed. Stories use it so the chart follows args like an element
// does. Temporary: a <tdk-chart> element replaces it in 0.1.0-alpha.3.
import type { BrokerSession } from '@tickdeck/broker';
import {
  attachTrading,
  createChartView,
  type ChartStyle,
  type ChartView,
  type PriceScaleMode,
  type TradingOverlay,
  type VolumeMode,
} from '@tickdeck/chart';
import type { MarketFeed } from '@tickdeck/datafeed';
import { fixedClock } from './scenario';

export class PlaygroundChart extends HTMLElement {
  feed?: MarketFeed;
  /** When set, the trading overlay draws this session's orders, exits and positions. */
  session?: BrokerSession;
  instrument = 'MOCK:ACME';
  timeframe = '5m';
  chartStyle: ChartStyle = 'candles';
  priceScaleMode: PriceScaleMode = 'normal';
  volume: VolumeMode = 'pane';
  /** `attachTrading` option: keep the trading lines in the autoscaled price range. */
  autoscaleTradingLines = true;
  theme: 'light' | 'dark' = 'light';
  view?: ChartView;
  overlay?: TradingOverlay;

  connectedCallback(): void {
    if (!this.feed || this.view) return;
    // The chart names its own root ("ACME, 5m chart", role img, focusable), so the host adds nothing.
    this.view = createChartView(this, {
      feed: this.feed,
      instrument: this.instrument,
      timeframe: this.timeframe,
      style: this.chartStyle,
      priceScaleMode: this.priceScaleMode,
      volume: this.volume,
      theme: this.theme,
      timezone: 'UTC',
      scheduler: fixedClock,
    });
    if (this.session) {
      this.overlay = attachTrading(this.view, this.session, {
        pnl: ['money', 'ticks'],
        autoscaleTradingLines: this.autoscaleTradingLines,
      });
    }
  }

  disconnectedCallback(): void {
    this.view?.dispose(); // also disposes the overlay
    this.view = undefined;
    this.overlay = undefined;
  }

  /** Resolves once the first history page is on screen. */
  async ready(): Promise<ChartView> {
    const view = this.view;
    if (!view) throw new Error('playground-chart is not attached');
    while (view.loading.value || view.bars.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    return view;
  }

  /** The engine's root: role img, named after the instrument and timeframe. */
  get root(): HTMLElement | null {
    return this.querySelector<HTMLElement>(':scope > [role="img"]');
  }

  /**
   * The chart's panes from top to bottom (price, volume when it has its own
   * pane, time axis): the root's children that hold canvases. Separators are left out.
   */
  panes(): HTMLElement[] {
    return [...(this.root?.children ?? [])].filter((child): child is HTMLElement => child instanceof HTMLElement && !!child.querySelector('canvas'));
  }
}

if (!customElements.get('playground-chart')) customElements.define('playground-chart', PlaygroundChart);

declare global {
  interface HTMLElementTagNameMap {
    'playground-chart': PlaygroundChart;
  }
}
