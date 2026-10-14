import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { TdkAccountPanelElement } from '@tickdeck/elements';
import { html } from 'lit';
import { expect, userEvent, waitFor } from 'storybook/test';
import { loadScenario, type Scenario } from '../src/scenario';
import { findPart, part, parts, retype, text, whenReady, widget } from '../src/testing';

interface PanelArgs {
  tab: 'orders' | 'positions' | 'fills';
  orderFilter: 'working' | 'all';
}

const panelOf = (canvasElement: HTMLElement) => widget(canvasElement, 'tdk-account-panel');
const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;
const rows = (panel: TdkAccountPanelElement) => parts(panel, 'tr[part="row"]');
const cell = (row: HTMLElement, column: string) => text(row.querySelector(`td[data-column="${column}"]`));

const meta = {
  title: 'Widgets/Account panel',
  component: 'tdk-account-panel',
  loaders: [loadScenario],
  args: { tab: 'orders', orderFilter: 'working' },
  argTypes: {
    tab: { control: 'inline-radio', options: ['orders', 'positions', 'fills'], description: 'Attribute `tab`' },
    orderFilter: { control: 'inline-radio', options: ['working', 'all'], description: 'Attribute `order-filter`' },
  },
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    return html`<div class="story-wide">
      <tdk-account-panel
        .session=${session}
        .feed=${feed}
        tab=${args.tab}
        order-filter=${args.orderFilter}
        theme=${globals.theme}
      ></tdk-account-panel>
    </div>`;
  },
} satisfies Meta<PanelArgs>;

export default meta;
type Story = StoryObj<PanelArgs>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await expect(await findPart(panel, '[part="empty"]')).toBeVisible();
    await expect(text(part(panel, '[part="summary"]'))).toContain('100,000.00');
  },
};

export const Loading: Story = {
  parameters: { scenario: { state: 'connecting' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await waitFor(() => expect(text(part(panel, '[part="status"]'))).toBe('Loading account…'));
  },
};

export const WorkingOrders: Story = {
  name: 'Orders: working, with held exits',
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await waitFor(() => expect(rows(panel)).toHaveLength(4));
    await expect(rows(panel).filter((row) => row.classList.contains('child'))).toHaveLength(2);
    await expect(rows(panel).map((row) => cell(row, 'status')).sort()).toEqual(['Held', 'Held', 'Working', 'Working']);
  },
};

export const AllOrders: Story = {
  name: 'Orders: all, with filled and cancelled',
  args: { orderFilter: 'all' },
  parameters: { scenario: { state: 'history' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await waitFor(() => expect(rows(panel).map((row) => cell(row, 'status')).sort()).toEqual(['Cancelled', 'Filled', 'Filled']));
  },
};

export const Positions: Story = {
  name: 'Positions: open, with exits and P&L',
  args: { tab: 'positions' },
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await waitFor(() => expect(rows(panel)).toHaveLength(1));
    const [row] = rows(panel);
    await expect(cell(row!, 'side')).toBe('Long');
    await expect(cell(row!, 'quantity')).toBe('10');
    await expect(Number(cell(row!, 'unrealized').replace(/[^\d.-]/g, ''))).toBeGreaterThan(0);
    await expect(cell(row!, 'take-profit')).not.toBe('');
  },
};

export const Fills: Story = {
  name: 'Fills',
  args: { tab: 'fills' },
  parameters: { scenario: { state: 'history' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await waitFor(() => expect(rows(panel)).toHaveLength(2));
    await expect(text(part(panel, '[part="summary"]'))).toMatch(/Realized P&L\s*\+?5\.80/);
  },
};

export const PartialClose: Story = {
  name: 'Partial close: quantity row',
  args: { tab: 'positions' },
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await userEvent.click(await findPart(panel, '[part~="close-button"]'));
    const input = await findPart<HTMLInputElement>(panel, '#close-quantity');
    await retype(input, '4');
    await expect(part(panel, '[part="close-row"]')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'false');
  },
};

export const PartialCloseConfirmed: Story = {
  name: 'Partial close: confirmed',
  args: { tab: 'positions' },
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement, loaded }) => {
    const panel = panelOf(canvasElement);
    const { session } = scenarioOf(loaded);
    await whenReady(panel);
    await userEvent.click(await findPart(panel, '[part~="close-button"]'));
    await retype(await findPart<HTMLInputElement>(panel, '#close-quantity'), '4');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(session.positions[0]?.quantity).toBe(6));
    await waitFor(() => expect(cell(rows(panel)[0]!, 'quantity')).toBe('6'));
  },
};

export const Disconnected: Story = {
  parameters: { scenario: { state: 'disconnected' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await waitFor(() => expect(text(part(panel, '[part="status"]'))).toMatch(/^Not connected to the broker/));
  },
};

export const Sorting: Story = {
  name: 'Sorting by a column',
  parameters: { scenario: { state: 'orders' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    await waitFor(() => expect(rows(panel)).toHaveLength(4));
    const instruments = () => rows(panel).map((row) => cell(row, 'instrument'));
    const header = parts(panel, '[part~="sort-button"]').find((button) => text(button).startsWith('Instrument'))!;
    await userEvent.click(header);
    await waitFor(() => expect(instruments()).toEqual(['ACME', 'BTCUSD', 'ES', 'EURUSD']));
    await expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(header);
    await waitFor(() => expect(instruments()).toEqual(['EURUSD', 'ES', 'BTCUSD', 'ACME']));
    await expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending');
  },
};

export const CancelFromPanel: Story = {
  name: 'Cancel from the panel',
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement, loaded }) => {
    const panel = panelOf(canvasElement);
    const { session } = scenarioOf(loaded);
    await whenReady(panel);
    const sell = session.orders.find((order) => order.side === 'sell' && !order.exitRole)!;
    await userEvent.click(await findPart(panel, `tr[data-id="${sell.id}"] [part~="cancel-button"]`));
    await waitFor(() => expect(session.getOrder(sell.id)?.state).toBe('cancelled'));
    await waitFor(() => expect(panel.shadowRoot?.querySelector(`tr[data-id="${sell.id}"]`) ?? null).toBeNull());
  },
};

export const KeyboardTabs: Story = {
  name: 'Keyboard: tabs',
  parameters: { scenario: { state: 'position' } },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement);
    await whenReady(panel);
    part(panel, '#tab-orders').focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(part(panel, '#tab-positions')).toHaveAttribute('aria-selected', 'true'));
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(part(panel, '#tab-fills')).toHaveAttribute('aria-selected', 'true'));
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(part(panel, '#tab-orders')).toHaveAttribute('aria-selected', 'true'));
  },
};

export const DarkTheme: Story = {
  name: 'Dark theme',
  globals: { theme: 'dark' },
  args: { tab: 'positions' },
  parameters: { scenario: { state: 'position' } },
};
