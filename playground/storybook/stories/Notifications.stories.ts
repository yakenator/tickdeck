import type { Meta, StoryObj } from '@storybook/web-components-vite';
import type { TdkNotificationsElement } from '@tickdeck/elements';
import type { NotificationInput } from '@tickdeck/widgets-core';
import { html, nothing } from 'lit';
import { expect, userEvent, waitFor } from 'storybook/test';
import { FAILED_CONNECT_REASON, fixedClock, loadScenario, round2, type Scenario } from '../src/scenario';
import { TIME_ZONES, findPart, part, parts, text, widget } from '../src/testing';

interface NotificationsArgs {
  placement: 'inline' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  hideLog: boolean;
  maxToasts: number;
  /** IANA time zone, or '' for the browser's. */
  timeZone: string;
}

const notificationsOf = (canvasElement: HTMLElement) => widget(canvasElement, 'tdk-notifications');
const scenarioOf = (loaded: Record<string, unknown>) => loaded.scenario as Scenario;
const titles = (element: TdkNotificationsElement) => parts(element, '[part="toast-title"]').map(text);

/** Pushes app messages that stay until dismissed. */
async function push(element: TdkNotificationsElement, ...inputs: NotificationInput[]) {
  await waitFor(() => expect(element.activeController).toBeTruthy());
  for (const input of inputs) element.activeController!.push({ durationMs: 0, ...input });
}

const meta = {
  title: 'Widgets/Notifications',
  component: 'tdk-notifications',
  loaders: [loadScenario],
  args: { placement: 'inline', hideLog: false, maxToasts: 4, timeZone: 'UTC' },
  argTypes: {
    placement: {
      control: 'select',
      options: ['inline', 'top-start', 'top-end', 'bottom-start', 'bottom-end'],
      description: 'Attribute `placement`',
    },
    hideLog: { control: 'boolean', description: 'Attribute `hide-log`' },
    maxToasts: { control: { type: 'number', min: 1, step: 1 }, description: 'Attribute `max-toasts`' },
    timeZone: {
      control: 'select',
      options: TIME_ZONES,
      labels: { '': "Browser's" },
      description: "Attribute `time-zone`: IANA time zone of the log's times (empty: the browser's)",
    },
  },
  render: (args, { loaded, globals }) => {
    const { session, feed } = scenarioOf(loaded);
    return html`<div class="story-column">
      <tdk-notifications
        .session=${session}
        .feed=${feed}
        placement=${args.placement}
        ?hide-log=${args.hideLog}
        max-toasts=${args.maxToasts}
        time-zone=${args.timeZone || nothing}
        .scheduler=${fixedClock}
        theme=${globals.theme}
      ></tdk-notifications>
    </div>`;
  },
} satisfies Meta<NotificationsArgs>;

export default meta;
type Story = StoryObj<NotificationsArgs>;

const level = (input: NotificationInput): Story => ({
  play: async ({ canvasElement }) => {
    const element = notificationsOf(canvasElement);
    await push(element, input);
    await waitFor(() => expect(part(element, `[part~="toast-${input.level}"]`)).toBeVisible());
  },
});

export const Info = level({ level: 'info', title: 'Market closes in 10 minutes', message: 'Working day orders expire at the close.' });
export const Success = level({ level: 'success', title: 'Order placed', message: 'Buy 10 ACME limit 110.75' });
export const Warning = level({ level: 'warning', title: 'Price far from the market', message: 'The limit is 5% below the bid.' });
export const ErrorLevel: Story = { ...level({ level: 'error', title: 'Order rejected', message: 'Quantity 1.5 is not a multiple of the quantity step' }), name: 'Error' };

export const Stacked: Story = {
  name: 'Stacked toasts',
  args: { maxToasts: 3 },
  play: async ({ canvasElement }) => {
    const element = notificationsOf(canvasElement);
    await push(
      element,
      { level: 'info', title: 'First' },
      { level: 'success', title: 'Second' },
      { level: 'warning', title: 'Third' },
      { level: 'error', title: 'Fourth' },
    );
    // The oldest leaves first when more than max-toasts are on screen.
    await waitFor(() => expect(titles(element)).toEqual(['Second', 'Third', 'Fourth']));
  },
};

export const LogOpen: Story = {
  name: 'Log open',
  play: async ({ canvasElement }) => {
    const element = notificationsOf(canvasElement);
    await push(element, { level: 'success', title: 'Order filled', message: 'Bought 10 ACME at 110.75' }, { level: 'info', title: 'Reconnected' });
    await userEvent.click(part(element, '[part~="log-toggle"]'));
    await waitFor(() => expect(parts(element, '[part~="log-item"]')).toHaveLength(2));
    await expect(part(element, '[part~="log-toggle"]')).toHaveAttribute('aria-expanded', 'true');
  },
};

export const DismissWithKeyboard: Story = {
  name: 'Keyboard: Escape dismisses',
  play: async ({ canvasElement }) => {
    const element = notificationsOf(canvasElement);
    await push(element, { level: 'info', title: 'Press Escape' });
    part(element, '[part~="dismiss-button"]').focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(titles(element)).toEqual([]));
  },
};

export const FillNotification: Story = {
  name: 'From the session: order filled',
  parameters: { scenario: { state: 'working' } },
  play: async ({ canvasElement, loaded }) => {
    const element = notificationsOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await waitFor(() => expect(element.activeController).toBeTruthy());
    await scenario.market(round2(scenario.price - 0.52));
    await waitFor(() => expect(titles(element)).toContain('Order filled'));
  },
};

export const RejectionNotification: Story = {
  name: 'From the session: order rejected',
  play: async ({ canvasElement, loaded }) => {
    const element = notificationsOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await waitFor(() => expect(element.activeController).toBeTruthy());
    await scenario.submit({ side: 'buy', kind: 'limit', quantity: 10, limitPrice: scenario.price - 0.005 });
    await waitFor(() => expect(titles(element)).toEqual(['Order rejected']));
    await expect(text(part(element, '[part="toast-message"]'))).toMatch(/tick size/);
  },
};

export const TimeoutNotification: Story = {
  name: 'From the session: no confirmation',
  parameters: { scenario: { holdOrderUpdates: true, ackTimeoutMs: 200 } },
  play: async ({ canvasElement, loaded }) => {
    const element = notificationsOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await waitFor(() => expect(element.activeController).toBeTruthy());
    await scenario.submit({ side: 'buy', kind: 'limit', quantity: 10, limitPrice: round2(scenario.price - 1) }).catch(() => {});
    await waitFor(() => expect(titles(element)).toContain('No confirmation from the broker'), { timeout: 3000 });
  },
};

export const ConnectionLost: Story = {
  name: 'From the session: connection lost',
  play: async ({ canvasElement, loaded }) => {
    const element = notificationsOf(canvasElement);
    const scenario = scenarioOf(loaded);
    await waitFor(() => expect(element.activeController).toBeTruthy());
    await scenario.broker.disconnect();
    await waitFor(() => expect(titles(element)).toContain('Connection to the broker lost'));
  },
};

export const ConnectFailed: Story = {
  name: 'From the session: could not connect',
  parameters: { scenario: { state: 'failed' } },
  play: async ({ canvasElement }) => {
    const element = notificationsOf(canvasElement);
    await waitFor(() => expect(titles(element)).toEqual(['Could not connect to the broker']), { timeout: 3000 });
    await expect(text(part(element, '[part="toast-message"]'))).toBe(FAILED_CONNECT_REASON);
    await expect(part(element, '[part~="toast-error"]')).toBeVisible();
  },
};

/** The time of a message logged on the fixed clock (2026-01-15 14:30 UTC) in each time zone. */
const LOG_TIMES: Record<string, string> = { UTC: '14:30:00', 'Asia/Seoul': '23:30:00', 'America/New_York': '09:30:00' };

export const TimeZone: Story = {
  name: 'Time zone: log times',
  args: { timeZone: 'UTC' },
  play: async ({ canvasElement, step }) => {
    const element = notificationsOf(canvasElement);
    await push(element, { level: 'success', title: 'Order filled', message: 'Bought 10 ACME at 110.75' });
    await userEvent.click(part(element, '[part~="log-toggle"]'));
    const logTime = () => text(element.shadowRoot?.querySelector('[part~="log-item"] time'));
    await waitFor(() => expect(logTime()).toBe(LOG_TIMES.UTC));
    for (const zone of ['Asia/Seoul', 'America/New_York', 'UTC']) {
      await step(`time-zone="${zone}" shows ${LOG_TIMES[zone]}`, async () => {
        element.setAttribute('time-zone', zone);
        await waitFor(() => expect(logTime()).toBe(LOG_TIMES[zone]));
      });
    }
    // The log is still open and holds the same message.
    await expect(parts(element, '[part~="log-item"]')).toHaveLength(1);
  },
};

export const CornerPlacement: Story = {
  name: 'Fixed to a corner',
  args: { placement: 'bottom-end' },
  play: async ({ canvasElement }) => {
    const element = notificationsOf(canvasElement);
    await push(element, { level: 'success', title: 'Take-profit filled', message: 'Sold 10 ACME at 111.50, P&L +7.50' });
    await expect(await findPart(element, '[part~="toast"]')).toBeVisible();
  },
};
