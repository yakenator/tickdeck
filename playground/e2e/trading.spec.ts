// The P1 scenario on every web app (cdn, vanilla, react, vue): a limit buy with
// take-profit and stop-loss from the ticket goes through fill, position and
// take-profit, and every step shows up in the panel, on the chart and as a toast.
// Along the way: the chart and the side column end at the same pixel (the
// equal-height layout), and volume shows in its own pane below the prices.
import { expect, test } from '@playwright/test';
import {
  VERSION,
  chartLines,
  expectEqualHeight,
  expectVolumePane,
  fmt,
  moveMarket,
  orders,
  panelRows,
  panelSummary,
  positions,
  round2,
  selectTab,
  snapshot,
  waitForApp,
  watchConsole,
} from './helpers';

test('limit buy with TP/SL from the ticket: placed, filled, closed at the take-profit', async ({ page }, testInfo) => {
  const problems = watchConsole(page);
  const ticket = page.locator('tdk-order-ticket');
  const toasts = page.locator('tdk-notifications [part~="toast"]');

  await test.step(`page loads tickdeck ${VERSION} with no console errors`, async () => {
    await page.goto('./');
    await expect(page.locator('#version')).toHaveText(VERSION);
    await waitForApp(page);
    await expect(page.locator('#chart canvas').first()).toBeVisible();
    for (const tag of ['tdk-trade-buttons', 'tdk-order-ticket', 'tdk-account-panel', 'tdk-notifications']) {
      expect(await page.evaluate((name) => !!customElements.get(name), tag), `${tag} is defined`).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  await test.step('the chart and the side column end at the same pixel; volume has its own pane', async () => {
    await expectEqualHeight(page, testInfo, 'as loaded');
    await expectVolumePane(page, testInfo);
  });

  // Pin the market to a known price. The levels stay on screen and well beyond
  // what the mock random walk moves during the test.
  const P0 = round2(await page.evaluate(() => (window as any).playground.view.bars.at(-1).close));
  await moveMarket(page, P0);
  const L = round2(P0 - 0.2);
  const TP = round2(P0 + 0.3);
  const SL = round2(P0 - 0.4);
  let entryId = '';

  await test.step(`place a limit buy of 10 at ${fmt(L)} with TP ${fmt(TP)} and SL ${fmt(SL)} from the ticket`, async () => {
    await ticket.locator('[part~="side"] [data-value="buy"]').click();
    await ticket.locator('[part~="kind"] [data-value="limit"]').click();
    await ticket.locator('#quantity').fill('10');
    await ticket.locator('#limitPrice').fill(fmt(L));
    await ticket.locator('[part~="take-profit"] input[type="checkbox"]').check();
    await ticket.locator('[part~="stop-loss"] input[type="checkbox"]').check();
    await ticket.locator('#takeProfit-price').fill(fmt(TP));
    await ticket.locator('#stopLoss-price').fill(fmt(SL));
    // The ticket grew with the exits; the row, and the chart, grow with it.
    await expectEqualHeight(page, testInfo, 'ticket with TP/SL');
    await expect(ticket.locator('[part~="submit-button"]')).toHaveText(`Buy 10 ACME limit ${fmt(L)}`);
    await ticket.locator('[part~="submit-button"]').click();
    await expect.poll(async () => (await orders(page)).find((order) => !order.exitRole && order.limitPrice === L)?.state).toBe('open');
    const entry = (await orders(page)).find((order) => !order.exitRole && order.limitPrice === L)!;
    expect(entry).toMatchObject({ takeProfit: TP, stopLoss: SL });
    entryId = entry.id;
  });

  await test.step('the order and its held exits appear in the panel and as chart lines', async () => {
    await expect
      .poll(async () => (await chartLines(page)).map((line) => `${line.kind}:${line.price}`).join())
      .toBe(`order:${L},take-profit:${TP},stop-loss:${SL}`);
    expect((await chartLines(page))[0]?.label).toBe('BUY LMT 10');
    await selectTab(page, 'orders');
    await expect(page.locator(`tdk-account-panel tr[data-id="${entryId}"] td[data-column="price"]`)).toHaveText(fmt(L));
    const rows = await panelRows(page);
    expect(rows.filter((row) => row.child)).toHaveLength(2);
    expect((await orders(page)).filter((order) => order.exitRole).map((order) => order.state)).toEqual(['held', 'held']);
    await snapshot(page, testInfo, 'order placed');
  });

  await test.step('moving the mock market through the limit fills the entry', async () => {
    await moveMarket(page, round2(L - 0.02));
    await expect.poll(async () => (await positions(page)).length).toBe(1);
    await expect(toasts.filter({ hasText: 'Order filled' }).first()).toBeVisible();
  });

  await test.step('the position shows with live P&L in the panel and on the chart', async () => {
    await moveMarket(page, round2(L + 0.1));
    await expect.poll(async () => (await chartLines(page)).find((line) => line.kind === 'position')?.pnl ?? 0).toBeGreaterThan(0);
    const lines = await chartLines(page);
    expect(lines.map((line) => line.kind)).toEqual(['position', 'take-profit', 'stop-loss']);
    expect(lines[0]).toMatchObject({ label: 'LONG 10', price: L });
    const [position] = await positions(page);
    expect(position).toMatchObject({ side: 'buy', quantity: 10, averagePrice: L, takeProfit: TP, stopLoss: SL });
    await selectTab(page, 'positions');
    await expect(page.locator(`tdk-account-panel tr[data-id="${position!.id}"] td[data-column="quantity"]`)).toHaveText('10');
    const [row] = await panelRows(page);
    expect(row?.cells).toMatchObject({ average: fmt(L), 'take-profit': fmt(TP), 'stop-loss': fmt(SL) });
    expect(Number(row?.cells.unrealized.replace(/[^\d.-]/g, ''))).toBeGreaterThan(0);
    expect(Object.keys(await panelSummary(page))).toContain('unrealized-pnl');
    await snapshot(page, testInfo, 'position with P&L');
  });

  await test.step('the take-profit fills: position closed, stop-loss cancelled, toast with the P&L', async () => {
    const realized = fmt(round2((TP - L) * 10));
    await moveMarket(page, round2(TP + 0.02));
    await expect.poll(async () => (await positions(page)).length).toBe(0);
    await expect.poll(async () => (await chartLines(page)).length).toBe(0);
    expect((await orders(page)).find((order) => order.exitRole === 'stop-loss')?.state).toBe('cancelled');
    await expect(page.locator('tdk-account-panel [part="empty"]')).toHaveText('No open positions');
    const toast = toasts.filter({ hasText: 'Take-profit filled' }).first();
    await expect(toast).toBeVisible();
    await expect(toast.locator('[part="toast-message"]')).toContainText(realized);
    await expect.poll(async () => (await panelSummary(page))['realized-pnl']).toContain(realized);
    await snapshot(page, testInfo, 'closed at the take-profit');
  });

  await test.step('no console errors or warnings during the run', async () => {
    expect(problems).toEqual([]);
  });
});
