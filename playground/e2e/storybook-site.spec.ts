// The Storybook build works where it is hosted, below /tickdeck/storybook/.
import { expect, test } from '@playwright/test';
import { watchConsole } from './helpers';

test('the hosted Storybook lists the stories and renders them below /tickdeck/storybook/', async ({ page, request }) => {
  const index = await (await request.get('storybook/index.json')).json();
  const stories = Object.values(index.entries as Record<string, { type: string; title: string }>).filter((entry) => entry.type === 'story');
  expect(stories.length).toBeGreaterThanOrEqual(60);
  expect(new Set(stories.map((story) => story.title))).toEqual(
    new Set(['Widgets/Order ticket', 'Widgets/Account panel', 'Widgets/Trade buttons', 'Widgets/Notifications', 'Chart/Chart view', 'Composite/Trading screen']),
  );

  // One story on its own, as the manager's preview frame loads it.
  const problems = watchConsole(page);
  await page.goto('storybook/iframe.html?id=composite-trading-screen--trading-screen&viewMode=story');
  // The open long position with its two exits and the working sell order.
  await expect(page.locator('tdk-account-panel #tab-positions [part="count"]')).toHaveText('1');
  await expect(page.locator('tdk-account-panel [part="row"]')).toHaveCount(3);
  await expect(page.locator('tdk-order-ticket [part~="submit-button"]')).toBeVisible();
  await expect(page.locator('playground-chart canvas').first()).toBeVisible();
  const installed = await page.evaluate(() => (customElements.get('tdk-order-ticket') ? 'defined' : 'missing'));
  expect(installed).toBe('defined');
  expect(problems).toEqual([]);

  // The manager with the sidebar.
  await page.goto('storybook/?path=/story/widgets-order-ticket--market');
  await expect(page.getByRole('link', { name: 'tickdeck Storybook' }).or(page.getByTitle('tickdeck Storybook')).first()).toBeVisible();
  await expect(page.frameLocator('#storybook-preview-iframe').locator('tdk-order-ticket')).toBeVisible();
});
