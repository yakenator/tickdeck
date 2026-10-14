import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { ChartStyle, PriceScaleMode, VolumeMode } from '@tickdeck/chart';
import { html } from 'lit';
import { expect, waitFor } from 'storybook/test';
import type { PlaygroundChart } from '../src/chart-host';
import { FAR_EXIT_DISTANCE, INSTRUMENTS, loadScenario, round2, type Scenario } from '../src/scenario';
import { edgePixels, volumeBarPixels } from '../src/testing';

interface ChartArgs {
  instrument: string;
  timeframe: string;
  chartStyle: ChartStyle;
  priceScaleMode: PriceScaleMode;
  volume: VolumeMode;
  trading: boolean;
  autoscaleTradingLines: boolean;
}

const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;
const chartOf = (canvasElement: HTMLElement) => {
  const chart = canvasElement.querySelector('playground-chart');
  if (!chart) throw new Error('No chart in the story');
  return chart;
};

/** The volume pane's share of the chart and its smallest height (createChartView). */
const VOLUME_SHARE = 0.2;
const VOLUME_MIN_HEIGHT = 48;
/** Volume bars on a 420 px chart cover tens of thousands of pixels; antialiased candle edges a handful. */
const DRAWN = 2000;
const NOT_DRAWN = 200;

/** Volume is drawn where `mode` puts it: in its own pane, at the bottom of the price pane, or nowhere. */
async function expectVolume(chart: PlaygroundChart, mode: VolumeMode): Promise<void> {
  const view = chart.view!;
  await expect(view.volume.value).toBe(mode);
  await waitFor(() => {
    const colors = [view.colors.value.volumeUp, view.colors.value.volumeDown];
    const panes = chart.panes();
    const root = chart.root!.getBoundingClientRect();
    if (mode === 'pane') {
      // Price, volume, time axis.
      expect(panes).toHaveLength(3);
      const volumePane = panes[1]!.getBoundingClientRect();
      expect(volumePane.height).toBeCloseTo(Math.max(VOLUME_MIN_HEIGHT, Math.round(root.height * VOLUME_SHARE)), 0);
      expect(volumeBarPixels(panes[1]!, colors)).toBeGreaterThan(DRAWN);
      expect(volumeBarPixels(panes[0]!, colors)).toBeLessThan(NOT_DRAWN);
    } else {
      // Price and time axis only.
      expect(panes).toHaveLength(2);
      if (mode === 'overlay') expect(volumeBarPixels(panes[0]!, colors)).toBeGreaterThan(DRAWN);
      else expect(volumeBarPixels(panes[0]!, colors)).toBeLessThan(NOT_DRAWN);
    }
  });
}

const meta = {
  title: 'Chart/Chart view',
  loaders: [loadScenario],
  args: {
    instrument: 'MOCK:ACME',
    timeframe: '5m',
    chartStyle: 'candles',
    priceScaleMode: 'normal',
    volume: 'pane',
    trading: false,
    autoscaleTradingLines: true,
  },
  argTypes: {
    instrument: { control: 'select', options: INSTRUMENTS, description: '`createChartView` option `instrument`' },
    timeframe: { control: 'select', options: ['1m', '5m', '15m', '1h', '4h', '1D'], description: 'Option `timeframe`' },
    chartStyle: { control: 'inline-radio', options: ['candles', 'bars', 'line', 'area'], description: 'Option `style`' },
    priceScaleMode: { control: 'inline-radio', options: ['normal', 'log', 'percent', 'indexed'], description: 'Option `priceScaleMode`' },
    volume: { control: 'inline-radio', options: ['pane', 'overlay', 'none'], description: 'Option `volume`' },
    trading: { control: 'boolean', description: '`attachTrading(view, session)`' },
    autoscaleTradingLines: {
      control: 'boolean',
      description: '`attachTrading` option `autoscaleTradingLines`: keep order, exit and position lines in the autoscaled range',
      if: { arg: 'trading' },
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          '`createChartView(container, options)` from `@tickdeck/chart`, with `attachTrading(view, session)` for orders, exits and positions. The stories use a fixed clock, so the bars are the same on every run. Volume is drawn in its own pane by default (`volume: \'pane\'`), at the bottom of the price pane (`overlay`) or not at all (`none`).',
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
      .volume=${args.volume}
      .autoscaleTradingLines=${args.autoscaleTradingLines}
      .theme=${globals.theme === 'dark' ? 'dark' : 'light'}
    ></playground-chart>`;
  },
  play: async ({ canvasElement, args }) => {
    const chart = chartOf(canvasElement);
    const view = await chart.ready();
    await expect(view.chartStyle.value).toBe(args.chartStyle);
    await expect(view.priceScaleMode.value).toBe(args.priceScaleMode);
    await expect(view.bars.length).toBeGreaterThan(100);
    await expect(canvasElement.querySelectorAll('playground-chart canvas').length).toBeGreaterThan(0);
    await expectVolume(chart, args.volume);
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

export const VolumePane: Story = { name: 'Volume: own pane (default)', args: { volume: 'pane' } };
export const VolumeOverlay: Story = { name: 'Volume: overlay', args: { volume: 'overlay' } };
export const VolumeNone: Story = { name: 'Volume: none', args: { volume: 'none' } };
export const VolumeDark: Story = { name: 'Volume: pane, dark theme', args: { volume: 'pane' }, globals: { theme: 'dark' } };

export const VolumeSwitch: Story = {
  name: 'Volume: switched with setVolume',
  play: async ({ canvasElement }) => {
    const chart = chartOf(canvasElement);
    const view = await chart.ready();
    for (const mode of ['overlay', 'none', 'pane'] as const) {
      view.setVolume(mode);
      await expectVolume(chart, mode);
    }
  },
};

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

/** Where the take-profit and stop-loss of the `far-exits` position are, relative to the price pane. */
async function farExits(chart: PlaygroundChart, price: number) {
  const view = await chart.ready();
  await waitFor(() => expect(chart.overlay?.scene.value.lines.map((line) => line.kind)).toEqual(['position', 'take-profit', 'stop-loss']));
  const pricePane = chart.panes()[0]!;
  const height = pricePane.getBoundingClientRect().height;
  const y = (target: number) => view.toPixel({ price: target }).y ?? Number.NaN;
  return {
    view,
    pricePane,
    height,
    takeProfitY: () => y(round2(price + FAR_EXIT_DISTANCE)),
    stopLossY: () => y(round2(price - FAR_EXIT_DISTANCE)),
  };
}

export const FarExitsAutoscaled: Story = {
  name: 'Trading lines outside the bars: kept in view (autoscale)',
  args: { trading: true, timeframe: '1m', autoscaleTradingLines: true },
  parameters: { scenario: { state: 'far-exits' } },
  play: async ({ canvasElement, loaded }) => {
    const chart = chartOf(canvasElement);
    const { price } = scenarioOf(loaded);
    const exits = await farExits(chart, price);
    // The axis scales to the bars and to every trading line, so both exits are inside the price pane.
    await waitFor(() => {
      expect(exits.takeProfitY()).toBeGreaterThanOrEqual(0);
      expect(exits.stopLossY()).toBeLessThanOrEqual(exits.height);
    });
  },
};

export const FarExitsEdgeMarkers: Story = {
  name: 'Trading lines outside the bars: edge markers (autoscaleTradingLines: false)',
  args: { trading: true, timeframe: '1m', autoscaleTradingLines: false },
  parameters: { scenario: { state: 'far-exits' } },
  play: async ({ canvasElement, loaded }) => {
    const chart = chartOf(canvasElement);
    const { price } = scenarioOf(loaded);
    const exits = await farExits(chart, price);
    const colors = exits.view.colors.value;
    // The axis scales to the bars only: the take-profit is above the pane and the stop-loss below it,
    // and each is marked at that edge with a tag in its color ("▲ TP 10", "▼ SL 10").
    await waitFor(() => {
      expect(exits.takeProfitY()).toBeLessThan(0);
      expect(exits.stopLossY()).toBeGreaterThan(exits.height);
      expect(edgePixels(exits.pricePane, colors.takeProfit, 'top')).toBeGreaterThan(50);
      expect(edgePixels(exits.pricePane, colors.stopLoss, 'bottom')).toBeGreaterThan(50);
    });
  },
};
