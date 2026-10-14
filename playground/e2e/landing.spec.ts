// The landing page names the pinned version and every link to an app resolves.
import { expect, test } from '@playwright/test';
import { VERSION, watchConsole } from './helpers';

test('the landing page shows the version and links to every app', async ({ page, request }) => {
  const problems = watchConsole(page);
  await page.goto('./');
  await expect(page.locator('[data-tickdeck-version]')).toHaveText(VERSION);
  await expect(page.locator('pre').first()).toContainText(`@tickdeck/all@${VERSION}/dist/tickdeck.js`);

  const links = await page.locator('a.open').evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
  expect(links.map((link) => new URL(link).pathname)).toEqual(['/tickdeck/cdn/', '/tickdeck/vanilla/', '/tickdeck/react/', '/tickdeck/vue/']);
  for (const link of links) {
    const response = await request.get(link);
    expect(response.status(), link).toBe(200);
    expect(await response.text(), link).toContain('<title>tickdeck');
  }
  expect(problems).toEqual([]);
});
