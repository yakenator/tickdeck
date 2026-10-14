import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html, nothing } from 'lit';
import { expect, userEvent, waitFor } from 'storybook/test';
import { FAILED_CONNECT_REASON, INSTRUMENTS, loadScenario, type Scenario } from '../src/scenario';
import { findPart, part, retype, text, whenReady, widget } from '../src/testing';

interface ButtonsArgs {
  instrument: string;
  quantity: number;
  confirm: boolean;
}

const buttonsOf = (canvasElement: HTMLElement) => widget(canvasElement, 'tdk-trade-buttons');
const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;

const meta = {
  title: 'Widgets/Trade buttons',
  component: 'tdk-trade-buttons',
  loaders: [loadScenario],
  args: { instrument: 'MOCK:ACME', quantity: 10, confirm: false },
  argTypes: {
    instrument: { control: 'select', options: ['', ...INSTRUMENTS], description: 'Attribute `instrument`' },
    quantity: { control: { type: 'number', min: 0, step: 1 }, description: 'Attribute `quantity`' },
    confirm: { control: 'boolean', description: 'Attribute `confirm`' },
  },
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    return html`<div class="story-column">
      <tdk-trade-buttons
        .session=${session}
        .feed=${feed}
        instrument=${args.instrument || nothing}
        quantity=${args.quantity}
        ?confirm=${args.confirm}
        theme=${globals.theme}
      ></tdk-trade-buttons>
    </div>`;
  },
} satisfies Meta<ButtonsArgs>;

export default meta;
type Story = StoryObj<ButtonsArgs>;

export const Normal: Story = {
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await whenReady(buttons);
    await expect(part(buttons, '[part~="buy-button"]')).toBeEnabled();
    await expect(part(buttons, '[part~="sell-button"]')).toBeEnabled();
    await expect(text(part(buttons, '[part~="spread"]'))).toContain('0.02');
  },
};

export const OneClickBuy: Story = {
  name: 'One-click buy opens a position',
  play: async ({ canvasElement, loaded }) => {
    const buttons = buttonsOf(canvasElement);
    const { session } = scenarioOf(loaded);
    await whenReady(buttons);
    await userEvent.click(part(buttons, '[part~="buy-button"]'));
    await waitFor(() => expect(session.positions.map((position) => [position.side, position.quantity])).toEqual([['buy', 10]]));
  },
};

export const ConfirmMode: Story = {
  name: 'Confirm mode: armed',
  args: { confirm: true },
  play: async ({ canvasElement, loaded }) => {
    const buttons = buttonsOf(canvasElement);
    const { session } = scenarioOf(loaded);
    await whenReady(buttons);
    await userEvent.click(part(buttons, '[part~="sell-button"]'));
    await expect(await findPart(buttons, '[part~="confirm-button"]')).toBeVisible();
    await expect(session.orders).toHaveLength(0);
  },
};

export const ConfirmModeConfirmed: Story = {
  name: 'Confirm mode: confirmed',
  args: { confirm: true },
  play: async ({ canvasElement, loaded }) => {
    const buttons = buttonsOf(canvasElement);
    const { session } = scenarioOf(loaded);
    await whenReady(buttons);
    await userEvent.click(part(buttons, '[part~="sell-button"]'));
    await userEvent.click(await findPart(buttons, '[part~="confirm-button"]'));
    await waitFor(() => expect(session.positions.map((position) => [position.side, position.quantity])).toEqual([['sell', 10]]));
  },
};

export const DisabledDisconnected: Story = {
  name: 'Disabled: not connected',
  parameters: { scenario: { state: 'disconnected' } },
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await waitFor(() => expect(buttons.activeController?.state.value.availability).toBe('disconnected'));
    await expect(part(buttons, '[part~="buy-button"]')).toBeDisabled();
    await expect(text(part(buttons, '[part="reason"]'))).toMatch(/connect/i);
  },
};

export const DisabledConnecting: Story = {
  name: 'Disabled: connecting',
  parameters: { scenario: { state: 'connecting' } },
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await waitFor(() => expect(buttons.activeController?.state.value.availability).toBe('connecting'));
    await expect(part(buttons, '[part~="buy-button"]')).toBeDisabled();
    await expect(part(buttons, '[part~="sell-button"]')).toBeDisabled();
    await expect(text(part(buttons, '[part="reason"]'))).toBe('Connecting to the broker…');
  },
};

export const DisabledConnectFailed: Story = {
  name: 'Disabled: could not connect',
  parameters: { scenario: { state: 'failed' } },
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await waitFor(() => expect(buttons.activeController?.state.value.availability).toBe('disconnected'), { timeout: 3000 });
    await expect(part(buttons, '[part~="buy-button"]')).toBeDisabled();
    await expect(text(part(buttons, '[part="reason"]'))).toBe(FAILED_CONNECT_REASON);
  },
};

export const DisabledNotTradable: Story = {
  name: 'Disabled: not tradable',
  parameters: { scenario: { rules: { 'MOCK:ACME': { tradable: false, reason: 'Trading halted' } } } },
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await waitFor(() => expect(buttons.activeController?.state.value.availability).toBe('not-tradable'));
    await expect(part(buttons, '[part~="buy-button"]')).toBeDisabled();
    await expect(text(part(buttons, '[part="reason"]'))).toContain('Trading halted');
  },
};

export const DisabledInvalidQuantity: Story = {
  name: 'Disabled: invalid quantity',
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await whenReady(buttons);
    await retype(part(buttons, '[part~="quantity-input"]'), '1.5');
    await waitFor(() => expect(part(buttons, '[part~="buy-button"]')).toBeDisabled());
    await expect(buttons.activeController?.state.value.quantityError).toBeTruthy();
  },
};

export const NoInstrument: Story = {
  name: 'Disabled: no instrument',
  args: { instrument: '' },
  play: async ({ canvasElement }) => {
    const buttons = buttonsOf(canvasElement);
    await waitFor(() => expect(buttons.activeController?.state.value.availability).toBe('no-instrument'));
  },
};

export const DarkTheme: Story = {
  name: 'Dark theme',
  globals: { theme: 'dark' },
};
