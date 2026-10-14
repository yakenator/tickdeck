import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { TdkAccountPanelElement, TdkOrderTicketElement } from '@tickdeck/elements';
import { html } from 'lit';
import { expect, userEvent, waitFor } from 'storybook/test';
import { loadScenario, round2, type Scenario } from '../src/scenario';
import { findPart, part, parts, retype, text, whenReady, widget } from '../src/testing';

const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;

/** The chart, the four widgets on one session, and the one line of wiring an app adds (Modify opens the ticket). */
const meta = {
  title: 'Composite/Trading screen',
  loaders: [loadScenario],
  parameters: { layout: 'fullscreen' },
  render: (_args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    const theme = globals.theme === 'dark' ? 'dark' : 'light';
    const amend = (event: CustomEvent) => {
      const ticket = (event.currentTarget as HTMLElement).closest('.story-screen')!.querySelector('tdk-order-ticket') as TdkOrderTicketElement;
      void ticket.amend(event.detail.order);
    };
    return html`<div class="story-screen" style="padding: 8px">
      <playground-chart .feed=${feed} .session=${session} .theme=${theme} .timeframe=${'1m'}></playground-chart>
      <div class="story-column">
        <tdk-trade-buttons .session=${session} .feed=${feed} instrument="MOCK:ACME" quantity="10" theme=${theme}></tdk-trade-buttons>
        <tdk-order-ticket .session=${session} .feed=${feed} instrument="MOCK:ACME" kind="limit" quantity="10" theme=${theme}></tdk-order-ticket>
      </div>
      <tdk-account-panel .session=${session} .feed=${feed} theme=${theme} @tdk-amend=${amend}></tdk-account-panel>
      <tdk-notifications .session=${session} .feed=${feed} placement="bottom-end" theme=${theme}></tdk-notifications>
    </div>`;
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const TradingScreen: Story = {
  name: 'Trading screen',
  parameters: { scenario: { state: 'position' } },
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
