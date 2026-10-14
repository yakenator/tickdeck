// The integrations an application wires itself (examples/README.md), on the
// vanilla, React and Vue apps: Alt-click a chart price into the ticket,
// instrument sync, Modify from the panel, and TP/SL editing on a position.
import { expect, test } from '@playwright/test';
import { chartLines, fmt, positions, round2, selectTab, ticketState, waitForApp, watchConsole } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await waitForApp(page);
});

test('Alt-click on the chart puts that price into the ticket; a plain click does not', async ({ page }) => {
  const problems = watchConsole(page);
  const chart = page.locator('#chart');
  const box = (await chart.boundingBox())!;
  const point = { x: Math.round(box.width * 0.4), y: Math.round(box.height * 0.35) };
  await chart.hover({ position: point });
  await expect.poll(() => page.evaluate(() => (window as any).playground.view.crosshair.value?.price)).toBeGreaterThan(0);
  const price = await page.evaluate(() => (window as any).playground.view.crosshair.value.price as number);

  await chart.click({ position: { x: point.x, y: point.y + 60 } });
  expect((await ticketState(page)).limitPrice).not.toBe(price);

  await chart.hover({ position: point });
  await chart.click({ position: point, modifiers: ['Alt'] });
  await expect.poll(async () => (await ticketState(page)).limitPrice).toBe(price);
  await expect(page.locator('tdk-order-ticket #limitPrice')).toHaveValue(fmt(price));
  expect(problems).toEqual([]);
});

test('the instrument selector switches the chart, the ticket and the trade buttons together', async ({ page }) => {
  await page.locator('#instrument').selectOption('MOCK:ES');
  await expect.poll(() => page.evaluate(() => (window as any).playground.view.instrumentInfo.value?.id)).toBe('MOCK:ES');
  await expect.poll(async () => (await ticketState(page)).instrumentId).toBe('MOCK:ES');
  await expect(page.locator('tdk-trade-buttons [part="instrument"]')).toHaveText('ES');
  await expect(page.locator('tdk-order-ticket [part="instrument"]')).toHaveText('ES');
});

test('Modify on an order of another instrument: everything follows it and the ticket amends it', async ({ page }) => {
  const esId = await page.evaluate(async () => {
    const { feed, session } = (window as any).playground;
    const [quote] = await feed.loadQuotes(['MOCK:ES']);
    return session.submitOrder({ instrument: 'MOCK:ES', side: 'buy', kind: 'limit', quantity: 1, limitPrice: Math.round((quote.bid - 25) * 4) / 4 });
  });
  await selectTab(page, 'orders');
  await page.locator(`tdk-account-panel tr[data-id="${esId}"] [part~="amend-button"]`).click();
  await expect.poll(async () => (await ticketState(page)).mode).toBe('amend');
  await expect(page.locator('#instrument')).toHaveValue('MOCK:ES');
  await expect.poll(() => page.evaluate(() => (window as any).playground.view.instrumentInfo.value?.id)).toBe('MOCK:ES');
  expect((await ticketState(page)).instrumentId).toBe('MOCK:ES');
  await expect(page.locator('tdk-order-ticket [part="mode"]')).toHaveText(`Changing ${esId}`);

  const current = (await ticketState(page)).limitPrice!;
  const amended = current - 5;
  await page.locator('tdk-order-ticket #limitPrice').fill(String(amended));
  await page.locator('tdk-order-ticket [part~="submit-button"]').click();
  await expect
    .poll(() => page.evaluate((id) => (window as any).playground.session.getOrder(id)?.limitPrice, esId))
    .toBe(amended);
  await expect.poll(async () => (await chartLines(page)).find((line) => line.id === `order:${esId}`)?.price).toBe(amended);
});

test('TP/SL in the account panel edits the position exits; the chart draws them', async ({ page }) => {
  await page.locator('tdk-trade-buttons [part~="buy-button"]').click();
  await expect.poll(async () => (await positions(page)).length).toBe(1);
  const [position] = await positions(page);
  await selectTab(page, 'positions');
  await page.locator(`tdk-account-panel tr[data-id="${position!.id}"] [part~="exits-button"]`).click();
  await expect(page.locator('#exits-form')).toBeVisible();
  const takeProfit = round2(position!.averagePrice + 1);
  const stopLoss = round2(position!.averagePrice - 1);
  await page.locator('#exits-take-profit').fill(fmt(takeProfit));
  await page.locator('#exits-stop-loss').fill(fmt(stopLoss));
  await page.locator('#exits-save').click();
  await expect(page.locator('#exits-form')).toBeHidden();
  await expect.poll(async () => (await positions(page))[0]).toMatchObject({ takeProfit, stopLoss });
  await expect
    .poll(async () => (await chartLines(page)).map((line) => `${line.kind}:${line.price}`).join())
    .toBe(`position:${position!.averagePrice},take-profit:${takeProfit},stop-loss:${stopLoss}`);
  await expect(page.locator(`tdk-account-panel tr[data-id="${position!.id}"] td[data-column="take-profit"]`)).toHaveText(fmt(takeProfit));
});
