// @vitest-environment node
import { expect, it } from 'vitest';

it('can be imported without a DOM, as in server-side rendering', async () => {
  expect(typeof window).toBe('undefined');
  const chart = await import('./index');
  expect(typeof chart.createChartView).toBe('function');
  expect(typeof chart.attachTrading).toBe('function');
});
