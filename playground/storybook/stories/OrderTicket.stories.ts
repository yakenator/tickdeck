import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { TdkOrderTicketElement } from '@tickdeck/elements';
import { html } from 'lit';
import { expect, userEvent, waitFor } from 'storybook/test';
import { FAILED_CONNECT_REASON, INSTRUMENTS, loadScenario, round2, type Scenario } from '../src/scenario';
import { findPart, part, parts, retype, text, whenReady, widget } from '../src/testing';

interface TicketArgs {
  instrument: string;
  side: 'buy' | 'sell';
  kind: 'market' | 'limit' | 'stop' | 'stop-limit';
  quantity: number;
  exitMode: 'price' | 'ticks';
  checkOrders: boolean;
}

const ticketOf = (canvasElement: HTMLElement) => widget(canvasElement, 'tdk-order-ticket');
const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;
const errors = (ticket: TdkOrderTicketElement) => parts(ticket, '[part~="error"]').map(text).filter(Boolean);

/** Enables an exit and types its value (a price, or a distance in ticks). */
async function setExit(ticket: TdkOrderTicketElement, field: 'takeProfit' | 'stopLoss', value: string) {
  const role = field === 'takeProfit' ? 'take-profit' : 'stop-loss';
  const checkbox = part<HTMLInputElement>(ticket, `[part~="${role}"] input[type="checkbox"]`);
  if (!checkbox.checked) await userEvent.click(checkbox);
  const mode = ticket.activeController?.state.value[field].mode ?? 'price';
  await retype(await findPart<HTMLInputElement>(ticket, `#${field}-${mode}`), value);
}

const meta = {
  title: 'Widgets/Order ticket',
  component: 'tdk-order-ticket',
  loaders: [loadScenario],
  args: { instrument: 'MOCK:ACME', side: 'buy', kind: 'limit', quantity: 10, exitMode: 'price', checkOrders: false },
  argTypes: {
    instrument: { control: 'select', options: INSTRUMENTS, description: 'Attribute `instrument`' },
    side: { control: 'inline-radio', options: ['buy', 'sell'], description: 'Attribute `side`' },
    kind: { control: 'select', options: ['market', 'limit', 'stop', 'stop-limit'], description: 'Attribute `kind`' },
    quantity: { control: { type: 'number', min: 0, step: 1 }, description: 'Attribute `quantity`' },
    exitMode: { control: 'inline-radio', options: ['price', 'ticks'], description: 'Attribute `exit-mode`' },
    checkOrders: { control: 'boolean', description: 'Property `checkOrders` (attribute `check-orders`)' },
  },
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    return html`<div class="story-column">
      <tdk-order-ticket
        .session=${session}
        .feed=${feed}
        .checkOrders=${args.checkOrders}
        instrument=${args.instrument}
        side=${args.side}
        kind=${args.kind}
        quantity=${args.quantity}
        exit-mode=${args.exitMode}
        theme=${globals.theme}
      ></tdk-order-ticket>
    </div>`;
  },
} satisfies Meta<TicketArgs>;

export default meta;
type Story = StoryObj<TicketArgs>;

export const Market: Story = {
  args: { kind: 'market' },
  play: async ({ canvasElement }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await expect(part(ticket, '[part~="submit-button"]')).toHaveTextContent('Buy 10 ACME at market');
  },
};

export const Limit: Story = {
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (scenarioOf(loaded).price - 0.5).toFixed(2));
    await expect(part(ticket, '[part~="submit-button"]')).toHaveTextContent(`Buy 10 ACME limit ${(scenarioOf(loaded).price - 0.5).toFixed(2)}`);
  },
};

export const Stop: Story = {
  args: { kind: 'stop' },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await retype(part(ticket, '#stopPrice'), (scenarioOf(loaded).price + 0.5).toFixed(2));
    await expect(errors(ticket)).toEqual([]);
  },
};

export const StopLimit: Story = {
  args: { kind: 'stop-limit' },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    const { price } = scenarioOf(loaded);
    await whenReady(ticket);
    await retype(part(ticket, '#stopPrice'), (price + 0.5).toFixed(2));
    await retype(part(ticket, '#limitPrice'), (price + 0.6).toFixed(2));
    await expect(errors(ticket)).toEqual([]);
  },
};

export const TakeProfitAndStopLossPrices: Story = {
  name: 'Take-profit and stop-loss (prices)',
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    const { price } = scenarioOf(loaded);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (price - 0.5).toFixed(2));
    await setExit(ticket, 'takeProfit', (price + 0.5).toFixed(2));
    await setExit(ticket, 'stopLoss', (price - 1).toFixed(2));
    await expect(text(part(ticket, '[part~="take-profit"] [part="hint"]'))).toBe('100 ticks');
    await expect(text(part(ticket, '[part~="stop-loss"] [part="hint"]'))).toBe('50 ticks');
    await expect(text(part(ticket, '[part~="estimates"]'))).toContain('Reward to take-profit');
  },
};

export const TakeProfitAndStopLossTicks: Story = {
  name: 'Take-profit and stop-loss (ticks)',
  args: { exitMode: 'ticks' },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    const { price } = scenarioOf(loaded);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (price - 0.5).toFixed(2));
    await setExit(ticket, 'takeProfit', '80');
    await setExit(ticket, 'stopLoss', '40');
    await expect(text(part(ticket, '[part~="take-profit"] [part="hint"]'))).toBe(`at ${round2(price - 0.5 + 0.8).toFixed(2)}`);
    await expect(text(part(ticket, '[part~="stop-loss"] [part="hint"]'))).toBe(`at ${round2(price - 0.5 - 0.4).toFixed(2)}`);
  },
};

export const OffTickPrice: Story = {
  name: 'Validation: price off the tick size',
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), `${(scenarioOf(loaded).price - 0.5).toFixed(2)}5`);
    await waitFor(() => expect(errors(ticket).join()).toMatch(/tick/i));
    await expect(part(ticket, '#limitPrice')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(part(ticket, '[part~="submit-button"]'));
    await expect(scenarioOf(loaded).session.orders).toHaveLength(0);
  },
};

export const OffStepQuantity: Story = {
  name: 'Validation: quantity off the step',
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (scenarioOf(loaded).price - 0.5).toFixed(2));
    await retype(part(ticket, '#quantity'), '1.5');
    await waitFor(() => expect(errors(ticket).join()).toMatch(/multiple|step/i));
    await expect(part(ticket, '#quantity')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const ExitOnWrongSide: Story = {
  name: 'Validation: take-profit on the wrong side',
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    const { price } = scenarioOf(loaded);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (price - 0.5).toFixed(2));
    await setExit(ticket, 'takeProfit', (price - 1).toFixed(2));
    await waitFor(() => expect(errors(ticket).join()).toMatch(/above/i));
  },
};

export const ReviewStep: Story = {
  name: 'Check and review step',
  args: { checkOrders: true },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (scenario.price - 0.5).toFixed(2));
    await userEvent.click(part(ticket, '[part~="submit-button"]'));
    const review = await findPart(ticket, '[part="review"]');
    await expect(text(review)).toContain('Confirm: Buy 10 ACME limit');
    await expect(scenario.session.orders).toHaveLength(0);
    await expect(part(ticket, '[part~="confirm-button"]')).toBeVisible();
  },
};

export const AmendMode: Story = {
  name: 'Amend mode',
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await whenReady(ticket);
    const order = scenario.session.orders.find((candidate) => candidate.side === 'buy' && !candidate.exitRole)!;
    await ticket.amend(order);
    await waitFor(() => expect(text(part(ticket, '[part="mode"]'))).toBe(`Changing ${order.id}`));
    await expect(part(ticket, '[part~="submit-button"]')).toHaveTextContent('Change order');
    await expect(part(ticket, '[part~="cancel-amend-button"]')).toBeVisible();
  },
};

export const Busy: Story = {
  name: 'Busy: waiting for the broker',
  parameters: { scenario: { holdOrderUpdates: true, ackTimeoutMs: 600_000 } },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (scenarioOf(loaded).price - 0.5).toFixed(2));
    await userEvent.click(part(ticket, '[part~="submit-button"]'));
    await waitFor(() => expect(part(ticket, '[part~="submit-button"]')).toHaveTextContent('Sending…'));
    await expect(part(ticket, '[part~="submit-button"]')).toHaveAttribute('aria-busy', 'true');
  },
};

export const AckTimeout: Story = {
  name: 'Acknowledgement timeout',
  parameters: { scenario: { holdOrderUpdates: true, ackTimeoutMs: 300 } },
  play: async ({ canvasElement, loaded }) => {
    const ticket = ticketOf(canvasElement);
    await whenReady(ticket);
    await retype(part(ticket, '#limitPrice'), (scenarioOf(loaded).price - 0.5).toFixed(2));
    await userEvent.click(part(ticket, '[part~="submit-button"]'));
    await waitFor(() => expect(text(part(ticket, '[part="result"]'))).toMatch(/confirm/i), { timeout: 3000 });
  },
};

export const Disconnected: Story = {
  parameters: { scenario: { state: 'disconnected' } },
  play: async ({ canvasElement }) => {
    const ticket = ticketOf(canvasElement);
    await waitFor(() => expect(ticket.activeController?.state.value.availability).toBe('disconnected'));
    await expect(text(part(ticket, '[part="status"]'))).toMatch(/connect/i);
    // Once the instrument's rules are loaded the form shows, with the submit button disabled.
    await waitFor(() => expect(ticket.activeController?.state.value.instrument).toBeDefined());
    await expect(await findPart(ticket, '[part~="submit-button"]')).toBeDisabled();
  },
};

export const Connecting: Story = {
  name: 'Connecting to the broker',
  parameters: { scenario: { state: 'connecting' } },
  play: async ({ canvasElement }) => {
    const ticket = ticketOf(canvasElement);
    await waitFor(() => expect(ticket.activeController?.state.value.availability).toBe('connecting'));
    await expect(text(part(ticket, '[part="status"]'))).toBe('Connecting to the broker…');
    // The mock broker answers trading rules before it is connected, so the form shows, with the submit button disabled.
    await waitFor(() => expect(ticket.activeController?.state.value.instrument).toBeDefined());
    await expect(await findPart(ticket, '[part~="submit-button"]')).toBeDisabled();
    await expect(ticket.activeController?.state.value.availability).toBe('connecting');
  },
};

export const ConnectFailed: Story = {
  name: 'Could not connect',
  parameters: { scenario: { state: 'failed' } },
  play: async ({ canvasElement }) => {
    const ticket = ticketOf(canvasElement);
    await waitFor(() => expect(ticket.activeController?.state.value.availability).toBe('disconnected'), { timeout: 3000 });
    await expect(text(part(ticket, '[part="status"]'))).toBe(FAILED_CONNECT_REASON);
    await waitFor(() => expect(ticket.activeController?.state.value.instrument).toBeDefined());
    await expect(await findPart(ticket, '[part~="submit-button"]')).toBeDisabled();
  },
};

export const DarkTheme: Story = {
  name: 'Dark theme',
  globals: { theme: 'dark' },
  args: { kind: 'market' },
};

export const InstrumentPicker: Story = {
  name: 'Instrument picker',
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    return html`<div class="story-column">
      <tdk-order-ticket
        .session=${session}
        .feed=${feed}
        .instruments=${[...INSTRUMENTS]}
        instrument=${args.instrument}
        kind=${args.kind}
        quantity=${args.quantity}
        theme=${globals.theme}
      ></tdk-order-ticket>
    </div>`;
  },
};

export const Keyboard: Story = {
  name: 'Keyboard: step, switch and submit',
  args: { kind: 'market' },
  play: async ({ canvasElement, loaded, step }) => {
    const ticket = ticketOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await whenReady(ticket);
    await step('arrow keys move through the order types', async () => {
      part(ticket, '[part~="kind"] [aria-checked="true"]').focus();
      await userEvent.keyboard('{ArrowRight}');
      await waitFor(() => expect(ticket.activeController?.state.value.kind).toBe('limit'));
      await expect(ticket.shadowRoot?.activeElement).toHaveAttribute('data-value', 'limit');
    });
    await step('ArrowUp and ArrowDown step the quantity and the price', async () => {
      part(ticket, '#quantity').focus();
      await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowDown}');
      await waitFor(() => expect(ticket.activeController?.state.value.quantity).toBe(11));
      ticket.usePrice(round2(scenario.price - 0.5));
      part(ticket, '#limitPrice').focus();
      await userEvent.keyboard('{ArrowDown}');
      await waitFor(() => expect(ticket.activeController?.state.value.limitPrice).toBe(round2(scenario.price - 0.51)));
    });
    await step('Enter submits the order', async () => {
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(scenario.session.orders.map((order) => [order.kind, order.quantity, order.limitPrice])).toEqual([['limit', 11, round2(scenario.price - 0.51)]]));
      await waitFor(() => expect(text(part(ticket, '[part="result"]'))).toContain('Order placed'));
    });
  },
};
