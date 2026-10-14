import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { ChartStyle, PriceScaleMode } from '@tickdeck/chart';
import { html } from 'lit';
import { expect, waitFor } from 'storybook/test';
import { INSTRUMENTS, loadScenario, type Scenario } from '../src/scenario';

interface ChartArgs {
  instrument: string;
  timeframe: string;
  chartStyle: ChartStyle;
  priceScaleMode: PriceScaleMode;
  trading: boolean;
}

const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;
const chartOf = (canvasElement: HTMLElement) => {
  const chart = canvasElement.querySelector('playground-chart');
  if (!chart) throw new Error('No chart in the story');
  return chart;
};

const meta = {
  title: 'Chart/Chart view',
  loaders: [loadScenario],
  args: { instrument: 'MOCK:ACME', timeframe: '5m', chartStyle: 'candles', priceScaleMode: 'normal', trading: false },
  argTypes: {
    instrument: { control: 'select', options: INSTRUMENTS, description: '`createChartView` option `instrument`' },
    timeframe: { control: 'select', options: ['1m', '5m', '15m', '1h', '4h', '1D'], description: 'Option `timeframe`' },
    chartStyle: { control: 'inline-radio', options: ['candles', 'bars', 'line', 'area'], description: 'Option `style`' },
    priceScaleMode: { control: 'inline-radio', options: ['normal', 'log', 'percent', 'indexed'], description: 'Option `priceScaleMode`' },
    trading: { control: 'boolean', description: '`attachTrading(view, session)`' },
  },
  parameters: {
    docs: {
      description: {
        component:
          '`createChartView(container, options)` from `@tickdeck/chart`, with `attachTrading(view, session)` for orders, exits and positions. The stories use a fixed clock, so the bars are the same on every run.',
      },
    },
  },
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    // A new element per render: the view is created when it is attached and disposed when it is removed.
    return html`<playground-chart
      .feed=${feed}
      .session=${args.trading ? session : undefined}
      .instrument=${args.instrument}
      .timeframe=${args.timeframe}
      .chartStyle=${args.chartStyle}
      .priceScaleMode=${args.priceScaleMode}
      .theme=${globals.theme === 'dark' ? 'dark' : 'light'}
    ></playground-chart>`;
  },
  play: async ({ canvasElement, args }) => {
    const view = await chartOf(canvasElement).ready();
    await expect(view.chartStyle.value).toBe(args.chartStyle);
    await expect(view.priceScaleMode.value).toBe(args.priceScaleMode);
    await expect(view.bars.length).toBeGreaterThan(100);
    await expect(canvasElement.querySelectorAll('playground-chart canvas').length).toBeGreaterThan(0);
  },
} satisfies Meta<ChartArgs>;

export default meta;
type Story = StoryObj<ChartArgs>;

export const Candles: Story = {};
export const Bars: Story = { args: { chartStyle: 'bars' } };
export const Line: Story = { args: { chartStyle: 'line' } };
export const Area: Story = { args: { chartStyle: 'area' } };
export const LogScale: Story = { name: 'Log scale', args: { priceScaleMode: 'log', timeframe: '1D' } };
export const PercentScale: Story = { name: 'Percent scale', args: { priceScaleMode: 'percent' } };
export const IndexedScale: Story = { name: 'Indexed to 100', args: { priceScaleMode: 'indexed' } };
export const DarkTheme: Story = { name: 'Dark theme', globals: { theme: 'dark' } };

export const TradingOverlay: Story = {
  name: 'Trading overlay: position, exits and a working order',
  args: { trading: true, timeframe: '1m' },
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement }) => {
    const chart = chartOf(canvasElement);
    await chart.ready();
    await waitFor(() =>
      expect(chart.overlay?.scene.value.lines.map((line) => `${line.kind}:${line.label}`)).toEqual([
        'position:LONG 10',
        'take-profit:TP 10',
        'stop-loss:SL 10',
        'order:SELL LMT 5',
      ]),
    );
    const position = chart.overlay!.scene.value.lines[0]!;
    await expect(position.pnl?.money).toBeGreaterThan(0);
  },
};

export const WorkingOrderWithExits: Story = {
  name: 'Trading overlay: working order with held exits',
  args: { trading: true, timeframe: '1m' },
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement }) => {
    const chart = chartOf(canvasElement);
    await chart.ready();
    await waitFor(() =>
      expect(chart.overlay?.scene.value.lines.map((line) => line.kind)).toEqual(['order', 'take-profit', 'stop-loss', 'order']),
    );
  },
};
