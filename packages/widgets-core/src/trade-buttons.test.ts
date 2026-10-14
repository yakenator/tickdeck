import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACME, NOW, setupTrading } from './test-setup';
import { TradeButtonsController, type TradeButtonsEvents } from './trade-buttons';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TradeButtonsController', () => {
  it('shows bid, ask and spread and buys or sells at market in one click', async () => {
    const { context, session, quote } = await setupTrading();
    await quote(100, 100.02);
    const buttons = new TradeButtonsController(context, { instrument: ACME, quantity: 3 });
    await buttons.ready;
    await quote(100.1, 100.13);
    const placed: TradeButtonsEvents['placed'][] = [];
    buttons.on('placed', (event) => placed.push(event));

    expect(buttons.state.value).toMatchObject({
      availability: 'ready',
      quantity: 3,
      quote: { bidText: '100.10', askText: '100.13', spreadText: '0.03' },
      buy: { enabled: true, priceText: '100.13', description: 'Buy 3 ACME at market' },
      sell: { enabled: true, priceText: '100.10', description: 'Sell 3 ACME at market' },
    });

    const buying = buttons.buy();
    expect(buttons.state.value).toMatchObject({ busy: 'buy', buy: { enabled: false, reason: 'Waiting for the broker' } });
    expect(await buying).toBe(true);
    expect(placed).toEqual([
      { orderId: expect.any(String), request: { instrument: ACME, side: 'buy', kind: 'market', quantity: 3 } },
    ]);
    expect(session.positions[0]).toMatchObject({ side: 'buy', quantity: 3, averagePrice: 100.13 });
    expect(buttons.state.value.result).toMatchObject({ level: 'success', message: 'Order placed: Buy 3 ACME at market' });

    buttons.stepQuantity(2);
    expect(await buttons.sell()).toBe(true);
    expect(session.positions[0]).toMatchObject({ side: 'sell', quantity: 2 });
  });

  it('explains why a side is disabled', async () => {
    const { context, session, quote, settle } = await setupTrading({
      broker: { rules: { 'MOCK:BTCUSD': { tradable: false, reason: 'Crypto is disabled on this account' } } },
    });
    await quote(100, 100.02);
    const buttons = new TradeButtonsController(context, { instrument: ACME });
    await buttons.ready;
    expect(buttons.state.value.quantity).toBe(1);

    buttons.setQuantity(1.5);
    expect(buttons.state.value.buy).toMatchObject({ enabled: false, reason: 'Use steps of 1' });
    buttons.setQuantity(1);

    await buttons.setInstrument('MOCK:BTCUSD');
    expect(buttons.state.value).toMatchObject({ availability: 'not-tradable', reason: 'Crypto is disabled on this account' });
    expect(buttons.state.value.sell).toMatchObject({ enabled: false, reason: 'Crypto is disabled on this account' });
    expect(await buttons.sell()).toBe(false);

    const quoteless = new TradeButtonsController({ session }, { instrument: ACME });
    await quoteless.ready;
    expect(quoteless.state.value.buy).toMatchObject({ enabled: false, reason: 'No ask price' });
    expect(quoteless.state.value.sell).toMatchObject({ enabled: false, reason: 'No bid price' });

    await buttons.setInstrument(ACME);
    await session.stop();
    await settle();
    expect(buttons.state.value).toMatchObject({ availability: 'disconnected', buy: { enabled: false, reason: 'Not connected to the broker' } });
  });

  it('asks for confirmation in confirm mode, and disarms after a while', async () => {
    const { context, session, quote } = await setupTrading();
    await quote(100, 100.02);
    const buttons = new TradeButtonsController(context, { instrument: ACME, confirm: true, confirmTimeoutMs: 3_000 });
    await buttons.ready;

    expect(await buttons.buy()).toBe(false);
    expect(buttons.state.value.armed).toBe('buy');
    expect(session.orders).toEqual([]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(buttons.state.value.armed).toBeUndefined();

    await buttons.sell();
    expect(buttons.state.value.armed).toBe('sell');
    buttons.cancelTrade();
    expect(buttons.state.value.armed).toBeUndefined();

    await buttons.sell();
    expect(await buttons.confirmTrade()).toBe(true);
    expect(buttons.state.value.armed).toBeUndefined();
    expect(session.positions[0]).toMatchObject({ side: 'sell', quantity: 1 });
  });
});
