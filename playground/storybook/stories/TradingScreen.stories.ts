import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { TdkAccountPanelElement, TdkOrderTicketElement } from '@tickdeck/elements';
import { html } from 'lit';
import { expect, userEvent, waitFor } from 'storybook/test';
import { loadScenario, round2, type Scenario } from '../src/scenario';
import { findPart, part, parts, retype, text, whenReady, widget } from '../src/testing';

interface ScreenArgs {
  kind: 'market' | 'limit' | 'stop' | 'stop-limit';
  chartMinHeight: number;
}

const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;

/** The chart, the four widgets on one session, and the one line of wiring an app adds (Modify opens the ticket). */
const meta = {
  title: 'Composite/Trading screen',
  loaders: [loadScenario],
  args: { kind: 'limit', chartMinHeight: 460 },
  argTypes: {
    kind: { control: 'select', options: ['market', 'limit', 'stop', 'stop-limit'], description: 'Ticket attribute `kind`' },
    chartMinHeight: {
      control: { type: 'number', min: 200, step: 20 },
      description: '`min-height` of the chart cell in pixels: the row is as tall as the taller of this and the side column',
    },
  },
  parameters: { layout: 'fullscreen' },
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    const theme = globals.theme === 'dark' ? 'dark' : 'light';
    const amend = (event: CustomEvent) => {
      const ticket = (event.currentTarget as HTMLElement).closest('.story-screen')!.querySelector('tdk-order-ticket') as TdkOrderTicketElement;
      void ticket.amend(event.detail.order);
    };
    return html`<div class="story-screen" style="padding: 8px">
      <playground-chart
        .feed=${feed}
        .session=${session}
        .theme=${theme}
        .timeframe=${'1m'}
        style=${`min-height: ${args.chartMinHeight}px`}
      ></playground-chart>
      <div class="story-column">
        <tdk-trade-buttons .session=${session} .feed=${feed} instrument="MOCK:ACME" quantity="10" theme=${theme}></tdk-trade-buttons>
        <tdk-order-ticket .session=${session} .feed=${feed} instrument="MOCK:ACME" kind=${args.kind} quantity="10" theme=${theme}></tdk-order-ticket>
      </div>
      <tdk-account-panel .session=${session} .feed=${feed} theme=${theme} @tdk-amend=${amend}></tdk-account-panel>
      <tdk-notifications .session=${session} .feed=${feed} placement="bottom-end" theme=${theme}></tdk-notifications>
    </div>`;
  },
} satisfies Meta<ScreenArgs>;

export default meta;
type Story = StoryObj<ScreenArgs>;

/** Bottom edges, in viewport pixels, of the chart cell, the chart it draws, the side column and the ticket's visible box. */
function measure(canvasElement: HTMLElement) {
  const chart = canvasElement.querySelector('playground-chart')!;
  const column = canvasElement.querySelector<HTMLElement>('.story-column')!;
  const ticket = widget(canvasElement, 'tdk-order-ticket');
  const cell = chart.getBoundingClientRect();
  const panes = chart.panes();
  return {
    chartTop: cell.top,
    chart: cell.bottom,
    chartHeight: cell.height,
    // The engine's root and its last pane (the time axis) end at the cell's content box: the chart fills its cell.
    drawn: chart.root!.getBoundingClientRect().bottom + parseFloat(getComputedStyle(chart).borderBottomWidth),
    lastPane: (panes.at(-1)?.getBoundingClientRect().bottom ?? 0) + parseFloat(getComputedStyle(chart).borderBottomWidth),
    columnTop: column.getBoundingClientRect().top,
    column: column.getBoundingClientRect().bottom,
    ticket: part(ticket, '[part~="form"]').getBoundingClientRect().bottom,
    ticketHeight: part(ticket, '[part~="form"]').getBoundingClientRect().height,
  };
}

type Layout = ReturnType<typeof measure>;

/**
 * The chart and the side column end at the same pixel (±1): the chart cell,
 * the chart drawn in it, the column and the ticket's visible box. Logs the
 * measurement for the test report.
 */
async function expectEqualHeight(canvasElement: HTMLElement, label: string): Promise<Layout> {
  let layout = measure(canvasElement);
  await waitFor(() => {
    layout = measure(canvasElement);
    expect(Math.abs(layout.chartTop - layout.columnTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.chart - layout.column)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.chart - layout.ticket)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.chart - layout.drawn)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.chart - layout.lastPane)).toBeLessThanOrEqual(1);
  });
  const round = (value: number) => Math.round(value * 10) / 10;
  console.info(
    `[equal-height] ${label}: chart ${round(layout.chartTop)}..${round(layout.chart)} (${round(layout.chartHeight)} px), ` +
      `column bottom ${round(layout.column)}, ticket box bottom ${round(layout.ticket)} (${round(layout.ticketHeight)} px), ` +
      `drawn chart bottom ${round(layout.drawn)}; max difference ${round(Math.max(...[layout.column, layout.ticket, layout.drawn].map((bottom) => Math.abs(bottom - layout.chart))))} px`,
  );
  return layout;
}

/** The chart has loaded its bars and the ticket its instrument, so both are at their final size. */
async function screenReady(canvasElement: HTMLElement): Promise<void> {
  await canvasElement.querySelector('playground-chart')!.ready();
  await whenReady(widget(canvasElement, 'tdk-order-ticket'));
  await whenReady(widget(canvasElement, 'tdk-trade-buttons'));
}

export const TradingScreen: Story = {
  name: 'Trading screen',
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement, args }) => {
    await screenReady(canvasElement);
    const layout = await expectEqualHeight(canvasElement, 'as loaded (limit ticket)');
    await expect(layout.chartHeight).toBeGreaterThanOrEqual(args.chartMinHeight - 1);
  },
};

export const EqualHeightWithExits: Story = {
  name: 'Equal height: TP/SL enabled (taller column)',
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement, args }) => {
    await screenReady(canvasElement);
    const ticket = widget(canvasElement, 'tdk-order-ticket');
    const before = await expectEqualHeight(canvasElement, 'limit ticket before TP/SL');
    await userEvent.click(part(ticket, '[part~="take-profit"] input[type="checkbox"]'));
    await userEvent.click(part(ticket, '[part~="stop-loss"] input[type="checkbox"]'));
    await findPart(ticket, '#stopLoss-price');
    const after = await expectEqualHeight(canvasElement, 'limit ticket with TP/SL');
    // The column grew past the chart's minimum, and the chart grew with it.
    await expect(after.chartHeight).toBeGreaterThan(Math.max(before.chartHeight, args.chartMinHeight) + 1);
  },
};

export const EqualHeightMarketOrder: Story = {
  name: 'Equal height: market order without exits',
  args: { kind: 'market' },
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement }) => {
    await screenReady(canvasElement);
    const ticket = widget(canvasElement, 'tdk-order-ticket');
    const exits = ['take-profit', 'stop-loss'].map((role) => part<HTMLInputElement>(ticket, `[part~="${role}"] input[type="checkbox"]`));
    const market = await expectEqualHeight(canvasElement, 'market ticket without exits');
    for (const checkbox of exits) await userEvent.click(checkbox);
    const withExits = await expectEqualHeight(canvasElement, 'market ticket with TP/SL');
    await expect(withExits.chartHeight).toBeGreaterThan(market.chartHeight + 1);
    // Without the exits again the row is shorter, and the chart shrinks back with it.
    for (const checkbox of exits) await userEvent.click(checkbox);
    const back = await expectEqualHeight(canvasElement, 'market ticket, exits removed again');
    await expect(Math.abs(back.chartHeight - market.chartHeight)).toBeLessThanOrEqual(1);
  },
};

export const EqualHeightTallChart: Story = {
  name: 'Equal height: chart taller than the column',
  args: { chartMinHeight: 720 },
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement, args }) => {
    await screenReady(canvasElement);
    const layout = await expectEqualHeight(canvasElement, `chart min-height ${args.chartMinHeight}px`);
    // The chart keeps its minimum, taller than the column: the ticket's box stretches down to the chart's bottom.
    await expect(Math.abs(layout.chartHeight - args.chartMinHeight)).toBeLessThanOrEqual(1);
  },
};

const rowIds = (panel: TdkAccountPanelElement) => parts(panel, 'tr[part="row"]').map((row) => row.dataset.id);

export const LimitWithExitsThenCancel: Story = {
  name: 'Limit order with TP/SL, then cancel from the panel',
  play: async ({ canvasElement, loaded, step }) => {
    const scenario = scenarioOf(loaded);
    const ticket = widget(canvasElement, 'tdk-order-ticket');
    const panel = widget(canvasElement, 'tdk-account-panel');
    const chart = canvasElement.querySelector('playground-chart')!;
    await whenReady(ticket);
    await chart.ready();
    let orderId = '';

    await step('submit a limit buy with take-profit and stop-loss', async () => {
      await retype(part(ticket, '#limitPrice'), round2(scenario.price - 0.5).toFixed(2));
      await userEvent.click(part(ticket, '[part~="take-profit"] input[type="checkbox"]'));
      await retype(await findPart(ticket, '#takeProfit-price'), round2(scenario.price + 0.5).toFixed(2));
      await userEvent.click(part(ticket, '[part~="stop-loss"] input[type="checkbox"]'));
      await retype(await findPart(ticket, '#stopLoss-price'), round2(scenario.price - 1).toFixed(2));
      await userEvent.click(part(ticket, '[part~="submit-button"]'));
      await waitFor(() => expect(scenario.session.orders.filter((order) => order.state !== 'pending')).toHaveLength(3));
      orderId = scenario.session.orders.find((order) => !order.exitRole)!.id;
    });

    await step('the panel lists the order and its held exits; the chart draws three lines', async () => {
      await waitFor(() => expect(rowIds(panel)).toHaveLength(3));
      await expect(rowIds(panel)[0]).toBe(orderId);
      await waitFor(() => expect(chart.overlay?.scene.value.lines.map((line) => line.kind)).toEqual(['order', 'take-profit', 'stop-loss']));
    });

    await step('Cancel in the panel removes the order, its exits and the lines', async () => {
      await userEvent.click(part(panel, `tr[data-id="${orderId}"] [part~="cancel-button"]`));
      await waitFor(() => expect(rowIds(panel)).toEqual([]));
      await waitFor(() => expect(chart.overlay?.scene.value.lines).toEqual([]));
    });
  },
};

export const FillAndTakeProfit: Story = {
  name: 'Fill, position and take-profit with notifications',
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement, loaded, step }) => {
    const scenario = scenarioOf(loaded);
    const panel = widget(canvasElement, 'tdk-account-panel');
    const notifications = widget(canvasElement, 'tdk-notifications');
    const toastTitles = () => parts(notifications, '[part="toast-title"]').map(text);
    await whenReady(panel);

    await step('the market trades through the limit: the entry fills', async () => {
      await scenario.market(round2(scenario.price - 0.52));
      await waitFor(() => expect(scenario.session.positions).toHaveLength(1));
      await waitFor(() => expect(toastTitles()).toContain('Order filled'));
      await waitFor(() => expect(text(part(panel, '#tab-positions [part="count"]'))).toBe('1'));
    });

    await step('the market reaches the take-profit: the position closes', async () => {
      await scenario.market(round2(scenario.price + 0.77));
      await waitFor(() => expect(scenario.session.positions).toHaveLength(0));
      await waitFor(() => expect(toastTitles()).toContain('Take-profit filled'));
      await expect(text(part(panel, '[part="summary"]'))).toMatch(/Realized P&L\s*\+?12\.50/);
    });
  },
};

export const ModifyOpensTheTicket: Story = {
  name: 'Modify in the panel opens the order in the ticket',
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement, loaded }) => {
    const scenario = scenarioOf(loaded);
    const ticket = widget(canvasElement, 'tdk-order-ticket');
    const panel = widget(canvasElement, 'tdk-account-panel');
    await whenReady(panel);
    const sell = scenario.session.orders.find((order) => order.side === 'sell' && !order.exitRole)!;
    await userEvent.click(await findPart(panel, `tr[data-id="${sell.id}"] [part~="amend-button"]`));
    await waitFor(() => expect(text(part(ticket, '[part="mode"]'))).toBe(`Changing ${sell.id}`));
    await retype(part(ticket, '#limitPrice'), round2(sell.limitPrice! + 0.1).toFixed(2));
    await userEvent.click(part(ticket, '[part~="submit-button"]'));
    await waitFor(() => expect(scenario.session.getOrder(sell.id)?.limitPrice).toBe(round2(sell.limitPrice! + 0.1)));
  },
};
