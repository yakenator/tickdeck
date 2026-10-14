import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';

/** The version every app is pinned to. */
export const VERSION = readFileSync(new URL('../tickdeck.version', import.meta.url), 'utf8').trim();

export const round2 = (value: number) => Math.round(value * 100) / 100;
export const fmt = (value: number) => value.toFixed(2);

/** Console errors and warnings, and uncaught exceptions, from the moment it is called. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  return problems;
}

/**
 * Every app exposes `window.playground = { feed, session, view, trading }`
 * once the chart exists; the widgets are the only tdk-* element of their kind.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const app = (window as any).playground;
    return !!app?.view && !!app.trading && app.view.bars.length > 0 && !app.view.loading.value;
  });
  await expect
    .poll(() => page.evaluate(() => (document.querySelector('tdk-order-ticket') as any)?.activeController?.state.value.availability))
    .toBe('ready');
}

export function ticketState(page: Page) {
  return page.evaluate(() => {
    const state = (document.querySelector('tdk-order-ticket') as any).activeController.state.value;
    return {
      mode: state.mode as string,
      kind: state.kind as string,
      side: state.side as string,
      instrumentId: state.instrumentId as string,
      limitPrice: state.limitPrice as number | undefined,
      stopPrice: state.stopPrice as number | undefined,
      bid: state.quote?.bid as number | undefined,
      ask: state.quote?.ask as number | undefined,
    };
  });
}

/** The trading overlay's lines, as drawn on the chart. */
export function chartLines(page: Page) {
  return page.evaluate(() =>
    (window as any).playground.trading.scene.value.lines.map((line: any) => ({
      id: line.id as string,
      kind: line.kind as string,
      price: line.price as number,
      label: line.label as string,
      pnl: line.pnl?.money as number | undefined,
    })),
  );
}

export function orders(page: Page) {
  return page.evaluate(() =>
    (window as any).playground.session.orders.map((order: any) => ({
      id: order.id as string,
      state: order.state as string,
      exitRole: order.exitRole as string | undefined,
      instrument: order.instrument as string,
      limitPrice: order.limitPrice as number | undefined,
      stopPrice: order.stopPrice as number | undefined,
      takeProfit: order.takeProfit as number | undefined,
      stopLoss: order.stopLoss as number | undefined,
    })),
  );
}

export function positions(page: Page) {
  return page.evaluate(() =>
    (window as any).playground.session.positions.map((position: any) => ({
      id: position.id as string,
      instrument: position.instrument as string,
      side: position.side as string,
      quantity: position.quantity as number,
      averagePrice: position.averagePrice as number,
      takeProfit: position.takeProfit as number | undefined,
      stopLoss: position.stopLoss as number | undefined,
      unrealizedPnl: position.unrealizedPnl as number | undefined,
    })),
  );
}

/** Uses the app's "Simulated market" control: one tick each side of `price`. */
export async function moveMarket(page: Page, price: number): Promise<void> {
  await page.locator('#market-price').fill(fmt(price));
  await page.locator('#market-price').press('Enter');
  await page.waitForTimeout(150);
}

export async function selectTab(page: Page, tab: 'orders' | 'positions' | 'history' | 'fills'): Promise<void> {
  await page.locator(`tdk-account-panel #tab-${tab}`).click();
}

/** The account panel's rows on the current tab, cells by column. */
export function panelRows(page: Page) {
  return page.evaluate(() =>
    [...(document.querySelector('tdk-account-panel') as any).shadowRoot.querySelectorAll('tr[part="row"]')].map((row: any) => ({
      id: row.dataset.id as string,
      child: row.classList.contains('child') as boolean,
      cells: Object.fromEntries(
        [...row.querySelectorAll('td[data-column]')].map((cell: any) => [cell.dataset.column, cell.textContent.replace(/\s+/g, ' ').trim()]),
      ) as Record<string, string>,
    })),
  );
}

export function panelSummary(page: Page) {
  return page.evaluate(
    () =>
      Object.fromEntries(
        [...(document.querySelector('tdk-account-panel') as any).shadowRoot.querySelectorAll('[part="summary-item"] dd')].map((item: any) => [
          item.dataset.id,
          item.textContent.trim(),
        ]),
      ) as Record<string, string>,
  );
}

export async function snapshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}
