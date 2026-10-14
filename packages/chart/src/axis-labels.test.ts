// @vitest-environment happy-dom
import { MockFeed } from '@tickdeck/datafeed';
import { afterEach, describe, expect, it } from 'vitest';
import { chartViewInternals, createChartView, type ChartView } from './chart-view';
import { CANDLE_PANE } from './engine';
import { createContainer, settle } from './test/dom';

interface DrawnText {
  text: string;
  y: number;
}

/** Records the texts each canvas shows: what was filled since the canvas was last cleared. */
const drawn = new Map<HTMLCanvasElement, DrawnText[]>();

function recordingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {
    measureText: (text: string) => ({ width: text.length * 6 }),
    clearRect: () => drawn.set(canvas, []),
    fillText: (text: string, _x: number, y: number) => drawn.get(canvas)?.push({ text, y }) ?? drawn.set(canvas, [{ text, y }]),
    getImageData: () => ({ data: [] }),
  };
  return new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : typeof key === 'string' ? () => undefined : undefined),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const views: ChartView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
  drawn.clear();
});

describe('price axis labels', () => {
  it('leaves out tick labels that the last price label would cover', async () => {
    const container = createContainer();
    const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (!context) contexts.set(this, (context = recordingContext(this)));
      return context;
    } as unknown as HTMLCanvasElement['getContext'];

    let checked = 0;
    for (const instrument of ['MOCK:ACME', 'MOCK:ES', 'MOCK:EURUSD', 'MOCK:BTCUSD']) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const view = createChartView(container, { feed: new MockFeed({ autoTick: false, seed }), instrument, timeframe: '1m', pageSize: 100 });
        views.push(view);
        await settle(30);
        const engine = chartViewInternals(view).engine;
        const close = view.bars.at(-1)!.close;
        const label = view.formatPrice(close);
        const axisCanvas = engine.getDom(CANDLE_PANE, 'yAxis')!.querySelector('canvas')!;
        const texts = drawn.get(axisCanvas) ?? [];
        // The axis groups thousands: 4,313.50.
        const isLabel = (text: DrawnText) => text.text.replace(/,/g, '') === label;
        const labelY = texts.find(isLabel)?.y;
        expect(labelY).toBeDefined();
        const ticks = texts.filter((text) => !isLabel(text));
        expect(ticks.length).toBeGreaterThan(2);
        // The label is 12px text with 4px padding above and below; a tick label is 12px text.
        expect(ticks.filter((tick) => Math.abs(tick.y - labelY!) < (4 + 12 + 4 + 12) / 2)).toEqual([]);
        checked++;
        view.dispose();
        views.pop();
      }
    }
    expect(checked).toBe(32);
  });
});
