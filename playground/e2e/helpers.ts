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

/**
 * Edges of the chart cell (`.chart-area` where the app frames the chart with a
 * status line, else `#chart`), the chart drawn in it, the side column and the
 * ticket's visible box (`::part(form)`), in viewport pixels.
 */
export function layoutEdges(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => element.getBoundingClientRect();
    const container = document.querySelector('#chart')!;
    const cell = document.querySelector('.chart-area') ?? container;
    const ticket = document.querySelector('tdk-order-ticket')!;
    const column = ticket.parentElement!;
    const form = ticket.shadowRoot!.querySelector('[part~="form"]')!;
    const root = container.querySelector(':scope > [role="img"]')!;
    const style = getComputedStyle(container);
    return {
      chartTop: box(cell).top,
      chart: box(cell).bottom,
      chartHeight: box(cell).height,
      columnTop: box(column).top,
      column: box(column).bottom,
      ticket: box(form).bottom,
      // The engine's root fills the chart container's content box.
      drawn: box(root).bottom,
      containerContent: box(container).bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
    };
  });
}

/**
 * The equal-height layout: the chart cell, the side column and the ticket's
 * visible box end at the same pixel (±1), and the chart fills its container.
 * Records the measurement as an annotation of the test.
 */
export async function expectEqualHeight(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const worst = async () => {
    const edges = await layoutEdges(page);
    return Math.max(
      Math.abs(edges.chartTop - edges.columnTop),
      Math.abs(edges.chart - edges.column),
      Math.abs(edges.chart - edges.ticket),
      Math.abs(edges.drawn - edges.containerContent),
    );
  };
  await expect.poll(worst, { message: `${label}: chart and side column end at the same pixel` }).toBeLessThanOrEqual(1);
  const edges = await layoutEdges(page);
  const round = (value: number) => Math.round(value * 10) / 10;
  const description =
    `${label}: chart ${round(edges.chartTop)}..${round(edges.chart)} (${round(edges.chartHeight)} px), column bottom ${round(edges.column)}, ` +
    `ticket box bottom ${round(edges.ticket)}, drawn chart bottom ${round(edges.drawn)} of ${round(edges.containerContent)}`;
  testInfo.annotations.push({ type: 'equal-height', description });
}

/**
 * The chart's panes (the root's children that hold canvases: price, volume
 * when it has its own pane, time axis) and how many pixels in the price and
 * volume panes are volume bars. The canvases are transparent and volume bars
 * are drawn in the `volumeUp` and `volumeDown` colors at half opacity, so they
 * are the only half-transparent pixels of those colors.
 */
export function volumeLayout(page: Page) {
  return page.evaluate(() => {
    const view = (window as any).playground.view;
    const root = document.querySelector('#chart > [role="img"]')!;
    const panes = [...root.children].filter((child) => child.querySelector('canvas'));
    // Pixels are read from a copy made for reading, so the chart's own canvases are never read back
    // (Chrome warns about repeated readbacks of a canvas without willReadFrequently).
    const scratch = document.createElement('canvas');
    const reader = scratch.getContext('2d', { willReadFrequently: true })!;
    const read = (source: HTMLCanvasElement) => {
      scratch.width = source.width;
      scratch.height = source.height;
      reader.clearRect(0, 0, scratch.width, scratch.height);
      reader.drawImage(source, 0, 0);
      return reader.getImageData(0, 0, scratch.width, scratch.height).data;
    };
    const rgb = (color: string) => {
      scratch.width = scratch.height = 1;
      reader.clearRect(0, 0, 1, 1);
      reader.fillStyle = color;
      reader.fillRect(0, 0, 1, 1);
      return [...reader.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const targets = [view.colors.value.volumeUp, view.colors.value.volumeDown].map(rgb);
    const volumePixels = (pane: Element | undefined) => {
      let count = 0;
      for (const canvas of pane?.querySelectorAll('canvas') ?? []) {
        if (canvas.width === 0 || canvas.height === 0) continue;
        const data = read(canvas);
        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3]!;
          if (alpha < 96 || alpha > 160) continue;
          if (targets.some(([r, g, b]) => Math.abs(data[index]! - r!) <= 12 && Math.abs(data[index + 1]! - g!) <= 12 && Math.abs(data[index + 2]! - b!) <= 12)) count += 1;
        }
      }
      return count;
    };
    return {
      mode: view.volume.value as string,
      chartHeight: root.getBoundingClientRect().height,
      panes: panes.map((pane) => pane.getBoundingClientRect().height),
      pricePixels: volumePixels(panes[0]),
      volumePixels: panes.length === 3 ? volumePixels(panes[1]) : 0,
    };
  });
}

/** Volume bars cover tens of thousands of pixels; the threshold leaves room for a narrow window. */
export const VOLUME_DRAWN = 2000;

/** Volume in its own pane below the prices: a fifth of the chart (at least 48 px) with the bars drawn in it. */
export async function expectVolumePane(page: Page, testInfo: TestInfo): Promise<void> {
  await expect.poll(async () => (await volumeLayout(page)).panes.length, { message: 'price, volume and time-axis panes' }).toBe(3);
  await expect.poll(async () => (await volumeLayout(page)).volumePixels, { message: 'volume bars drawn in the volume pane' }).toBeGreaterThan(VOLUME_DRAWN);
  const layout = await volumeLayout(page);
  expect(layout.mode).toBe('pane');
  const [, volumePane] = layout.panes;
  expect(volumePane).toBeGreaterThanOrEqual(48);
  expect(Math.abs(volumePane! - Math.max(48, Math.round(layout.chartHeight * 0.2)))).toBeLessThanOrEqual(2);
  expect(layout.pricePixels).toBeLessThan(VOLUME_DRAWN / 10);
  testInfo.annotations.push({
    type: 'volume',
    description: `volume pane ${Math.round(volumePane!)} px of ${Math.round(layout.chartHeight)} px, ${layout.volumePixels} volume-bar pixels`,
  });
}
