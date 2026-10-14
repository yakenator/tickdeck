// <playground-chart>: createChartView and attachTrading in a sized element,
// created when it is attached and disposed when it is removed. Stories use it
// so the chart follows args like an element does.
import type { BrokerSession } from '@tickdeck/broker';
import {
  attachTrading,
  createChartView,
  type ChartStyle,
  type ChartView,
  type PriceScaleMode,
  type TradingOverlay,
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
  theme: 'light' | 'dark' = 'light';
  view?: ChartView;
  overlay?: TradingOverlay;

  connectedCallback(): void {
    if (!this.feed || this.view) return;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', `${this.instrument} ${this.timeframe} price chart`);
    this.view = createChartView(this, {
      feed: this.feed,
      instrument: this.instrument,
      timeframe: this.timeframe,
      style: this.chartStyle,
      priceScaleMode: this.priceScaleMode,
      theme: this.theme,
      timezone: 'UTC',
      scheduler: fixedClock,
    });
    if (this.session) this.overlay = attachTrading(this.view, this.session, { pnl: ['money', 'ticks'] });
    // Marks the engine's root so the stories' accessibility config can scope a known issue to it (see preview.ts).
    this.firstElementChild?.setAttribute('data-chart-engine-root', '');
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
}

if (!customElements.get('playground-chart')) customElements.define('playground-chart', PlaygroundChart);

declare global {
  interface HTMLElementTagNameMap {
    'playground-chart': PlaygroundChart;
  }
}
