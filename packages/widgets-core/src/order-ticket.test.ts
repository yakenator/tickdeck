import { MockBroker, type OrderCheck, type OrderRequest } from '@tickdeck/broker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPanelController } from './account-panel';
import { OrderTicketController, type OrderTicketEvents } from './order-ticket';
import { ACME, NOW, setupTrading } from './test-setup';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function ticketSetup(options: Parameters<typeof setupTrading>[0] = {}, ticketOptions = {}) {
  const trading = await setupTrading(options);
  await trading.quote(100.0, 100.02);
  const ticket = new OrderTicketController(trading.context, { instrument: ACME, ...ticketOptions });
  await ticket.ready;
  return { ...trading, ticket };
}

describe('OrderTicketController validation', () => {
  it('checks the quantity against the minimum, maximum and step', async () => {
    const { ticket } = await ticketSetup({ broker: { rules: { [ACME]: { quantity: { min: 5, max: 100, step: 5 } } } } });
    const state = () => ticket.state.value;

    expect(state()).toMatchObject({ availability: 'ready', quantity: 5, canSubmit: true, errors: {} });

    ticket.setQuantity(7);
    expect(state().errors.quantity).toBe('Use steps of 5');
    expect(state().visibleErrors.quantity).toBe('Use steps of 5');
    expect(state().canSubmit).toBe(false);
    ticket.setQuantity(2);
    expect(state().errors.quantity).toBe('Minimum is 5');
    ticket.setQuantity(500);
    expect(state().errors.quantity).toBe('Maximum is 100');
    ticket.setQuantity(Number.NaN);
    expect(state().errors.quantity).toBe('Enter a number');
    ticket.setQuantity(undefined);
    expect(state().errors.quantity).toBe('Enter a quantity');

    // Quick steps snap onto the grid and stay within the limits.
    ticket.setQuantity(7);
    ticket.stepQuantity(1);
    expect(state().quantity).toBe(10);
    ticket.stepQuantity(1);
    expect(state().quantity).toBe(15);
    ticket.stepQuantity(-2);
    expect(state().quantity).toBe(5);
    ticket.stepQuantity(-1);
    expect(state().quantity).toBe(5);
    ticket.setQuantity(100);
    ticket.stepQuantity(1);
    expect(state().quantity).toBe(100);
    expect(state().errors).toEqual({});
  });

  it('snaps prices to the tick size and checks the side of the market', async () => {
    const { ticket, quote } = await ticketSetup();
    const state = () => ticket.state.value;

    ticket.setKind('limit');
    expect(state()).toMatchObject({ kind: 'limit', limitPrice: 100, needsLimitPrice: true, canSubmit: true });

    ticket.setLimitPrice(99.555);
    expect(state().errors.limitPrice).toBe('Use multiples of the tick size 0.01 (nearest 99.56)');
    expect(state().canSubmit).toBe(false);
    ticket.stepPrice('limitPrice', 1);
    expect(state().limitPrice).toBe(99.56);
    ticket.stepPrice('limitPrice', -3);
    expect(state().limitPrice).toBe(99.53);

    // A buy limit above the ask is allowed but fills at once.
    ticket.setLimitPrice(100.05);
    expect(state().errors).toEqual({});
    expect(state().warnings).toEqual(['The limit is at or above the ask (100.02), so the order fills at once']);

    // Stops must be on the far side of the market.
    ticket.setKind('stop');
    expect(state().stopPrice).toBe(100.03);
    ticket.setStopPrice(99.9);
    expect(state().errors.stopPrice).toBe('A buy stop must be above the ask (100.02)');
    ticket.setSide('sell');
    expect(state().errors.stopPrice).toBeUndefined();
    await quote(99.8, 99.82);
    expect(state().errors.stopPrice).toBe('A sell stop must be below the bid (99.80)');

    ticket.setKind('stop-limit');
    ticket.setStopPrice(99.5);
    ticket.setLimitPrice(99.6);
    expect(state().errors).toEqual({});
    expect(state().warnings).toEqual(['The limit is above the stop, so the order may not fill once triggered']);
    expect(state().summary).toBe('Sell 1 ACME stop 99.50 limit 99.60');
  });

  it('turns take-profit and stop-loss distances in ticks into prices', async () => {
    const { ticket, quote } = await ticketSetup();
    const state = () => ticket.state.value;
    ticket.setKind('limit');
    ticket.setLimitPrice(99.5);
    ticket.setQuantity(10);
    ticket.setExitTicks('takeProfit', 150);
    ticket.setExitTicks('stopLoss', 100);

    expect(state().takeProfit).toMatchObject({ enabled: true, mode: 'ticks', ticks: 150, resolvedPrice: 101 });
    expect(state().stopLoss).toMatchObject({ enabled: true, mode: 'ticks', ticks: 100, resolvedPrice: 98.5 });
    expect(state().estimates.map((item) => [item.id, item.text])).toEqual([
      ['notional', '995.00 USD'],
      ['risk', '10.00 USD'],
      ['reward', '15.00 USD'],
    ]);

    // For a sell, take-profit lies below the entry and stop-loss above.
    ticket.setSide('sell');
    expect(state().takeProfit.resolvedPrice).toBe(98);
    expect(state().stopLoss.resolvedPrice).toBe(100.5);

    // Switching to price entry keeps the price; a price on the wrong side is an error.
    ticket.setExitMode('takeProfit', 'price');
    expect(state().takeProfit).toMatchObject({ mode: 'price', price: 98, resolvedTicks: 150 });
    ticket.setExitPrice('takeProfit', 100);
    expect(state().errors.takeProfit).toBe('Take-profit must be below the entry price (99.50)');
    ticket.setExitPrice('takeProfit', 98.005);
    expect(state().errors.takeProfit).toBe('Use multiples of the tick size 0.01 (nearest 98.01)');
    ticket.setExitMode('takeProfit', 'ticks');
    ticket.setExitTicks('takeProfit', 2.5);
    expect(state().errors.takeProfit).toBe('Use a whole number of ticks above zero');

    // Market orders measure from the ask (buy) and follow the quote.
    ticket.setSide('buy');
    ticket.setKind('market');
    ticket.setExitTicks('takeProfit', 10);
    expect(state().referencePrice).toBe(100.02);
    expect(state().takeProfit.resolvedPrice).toBe(100.12);
    await quote(100.5, 100.52);
    expect(state().takeProfit.resolvedPrice).toBe(100.62);
    expect(state().stopLoss.resolvedPrice).toBe(99.52);
  });

  it('reports availability: no instrument, loading, not tradable, disconnected', async () => {
    const { context, session, settle } = await setupTrading({
      broker: { rules: { 'MOCK:BTCUSD': { tradable: false, reason: 'Crypto is disabled on this account' } } },
    });
    const ticket = new OrderTicketController(context);
    expect(ticket.state.value).toMatchObject({ availability: 'no-instrument', reason: 'Choose an instrument', canSubmit: false });

    const loading = ticket.setInstrument('MOCK:BTCUSD');
    expect(ticket.state.value.availability).toBe('loading');
    await loading;
    expect(ticket.state.value).toMatchObject({ availability: 'not-tradable', reason: 'Crypto is disabled on this account' });

    await ticket.setInstrument(ACME);
    expect(ticket.state.value.availability).toBe('ready');
    await session.stop();
    await settle();
    expect(ticket.state.value).toMatchObject({ availability: 'disconnected', canSubmit: false });
  });
});

describe('OrderTicketController submitting', () => {
  it('places a limit order with exits that then shows up in the account panel', async () => {
    const { ticket, context, session, quote, settle } = await ticketSetup();
    const panel = new AccountPanelController(context);
    const placed: OrderTicketEvents['placed'][] = [];
    ticket.on('placed', (event) => placed.push(event));

    ticket.setKind('limit');
    ticket.setLimitPrice(99.5);
    ticket.setQuantity(10);
    ticket.setExitPrice('takeProfit', 101);
    ticket.setExitPrice('stopLoss', 98.5);
    const submitting = ticket.submit();
    expect(ticket.state.value).toMatchObject({ phase: 'submitting', busy: true, canSubmit: false });
    expect(await submitting).toBe(true);

    const orderId = placed[0]!.orderId;
    expect(placed).toEqual([
      {
        orderId,
        request: {
          instrument: ACME,
          side: 'buy',
          kind: 'limit',
          quantity: 10,
          limitPrice: 99.5,
          timeInForce: 'gtc',
          takeProfit: 101,
          stopLoss: 98.5,
        },
      },
    ]);
    expect(ticket.state.value).toMatchObject({
      phase: 'editing',
      busy: false,
      result: { level: 'success', message: 'Order placed: Buy 10 ACME limit 99.50', orderId },
    });
    await settle();

    const orders = panel.state.value.orders;
    expect(orders.map((row) => [row.cells.type, row.cells.side, row.cells.quantity, row.cells.price, row.cells.status])).toEqual([
      ['Limit', 'Buy', '10', '99.50', 'Working'],
      ['Take-profit', 'Sell', '10', '101.00', 'Held'],
      ['Stop-loss', 'Sell', '10', '98.50', 'Held'],
    ]);
    expect(orders[0]).toMatchObject({ id: orderId, canCancel: true, canAmend: true, label: 'Buy 10 ACME Limit 99.50' });
    expect(orders.map((row) => row.parentId)).toEqual([undefined, orderId, orderId]);
    expect(orders[0]!.cells.exits).toBe('TP 101.00 · SL 98.50');
    expect(panel.state.value.counts).toEqual({ orders: 3, positions: 0, fills: 0 });

    await quote(99.4, 99.48);
    expect(session.getOrder(orderId)?.state).toBe('filled');
    expect(panel.state.value.positions.map((row) => row.cells)).toEqual([
      {
        instrument: 'ACME',
        side: 'Long',
        quantity: '10',
        average: '99.50',
        last: '99.40',
        unrealized: '-1.00',
        realized: '0.00',
        'take-profit': '101.00',
        'stop-loss': '98.50',
      },
    ]);
    expect(panel.state.value.positions[0]!.tones).toMatchObject({ side: 'buy', unrealized: 'negative' });
    expect(panel.state.value.orders.map((row) => [row.cells.type, row.cells.status])).toEqual([
      ['Stop-loss', 'Working'],
      ['Take-profit', 'Working'],
    ]);
  });

  it('checks the order first and sends it with the confirmation token', async () => {
    const checked: OrderRequest[] = [];
    class CheckingBroker extends MockBroker {
      override async checkOrder(request: OrderRequest): Promise<OrderCheck> {
        checked.push(request);
        const check = await super.checkOrder(request);
        return request.quantity > 50 ? { ...check, confirmationToken: undefined, errors: ['Not enough buying power'] } : check;
      }
    }
    const submit = vi.spyOn(CheckingBroker.prototype, 'submitOrder');
    const { ticket, session } = await ticketSetup({ createBroker: (options) => new CheckingBroker(options) }, { checkOrders: true });

    ticket.setQuantity(80);
    expect(await ticket.submit()).toBe(false);
    expect(ticket.state.value).toMatchObject({ phase: 'editing', result: { level: 'error', message: 'Not enough buying power' } });

    ticket.setQuantity(4);
    expect(await ticket.submit()).toBe(true);
    const review = ticket.state.value.review!;
    expect(ticket.state.value.phase).toBe('review');
    expect(review.estimates.map((item) => [item.id, item.text])).toEqual([
      ['cost', '400.08 USD'],
      ['commission', '0.00 USD'],
    ]);
    expect(review.warnings).toEqual(['Market orders fill at the current bid or ask.']);
    expect(submit).not.toHaveBeenCalled();

    // Editing drops the review; it has to be checked again.
    ticket.setQuantity(5);
    expect(ticket.state.value).toMatchObject({ phase: 'editing', review: undefined });
    await ticket.submit();
    const token = ticket.state.value.review!.confirmationToken;
    expect(token).toMatch(/^check-/);

    expect(await ticket.confirm()).toBe(true);
    expect(submit).toHaveBeenCalledWith({ instrument: ACME, side: 'buy', kind: 'market', quantity: 5, timeInForce: 'gtc' }, token);
    expect(ticket.state.value).toMatchObject({ phase: 'editing', result: { level: 'success' } });
    expect(session.positions[0]).toMatchObject({ side: 'buy', quantity: 5 });
    expect(checked).toHaveLength(3);
  });

  it('amends a working order opened from the account panel', async () => {
    const { ticket, context, session, settle } = await ticketSetup();
    const panel = new AccountPanelController(context);
    panel.on('amend', (order) => void ticket.amend(order));
    const amended: OrderTicketEvents['amended'][] = [];
    ticket.on('amended', (event) => amended.push(event));

    const orderId = await session.submitOrder({ instrument: ACME, side: 'sell', kind: 'limit', quantity: 3, limitPrice: 101, stopLoss: 102 });
    await settle();
    panel.requestAmend(orderId);
    await settle();
    expect(ticket.state.value).toMatchObject({
      mode: 'amend',
      side: 'sell',
      kind: 'limit',
      quantity: 3,
      limitPrice: 101,
      editable: { side: false, kind: false, quantity: true },
      stopLoss: { enabled: true, price: 102 },
      summary: 'Change: Sell 3 ACME limit 101.00',
    });

    expect(await ticket.submit()).toBe(false);
    expect(ticket.state.value.result).toEqual({ level: 'info', message: 'Nothing to change' });

    ticket.setLimitPrice(100.9);
    ticket.setExitEnabled('stopLoss', false);
    expect(await ticket.submit()).toBe(true);
    expect(amended).toEqual([{ orderId, changes: { limitPrice: 100.9, stopLoss: null } }]);
    expect(session.getOrder(orderId)).toMatchObject({ limitPrice: 100.9, stopLoss: undefined });
    expect(ticket.state.value).toMatchObject({ mode: 'new', amendOrder: undefined, result: { level: 'success' } });
  });

  it('leaves amend mode when the order ends meanwhile', async () => {
    const { ticket, session, settle } = await ticketSetup();
    const orderId = await session.submitOrder({ instrument: ACME, side: 'buy', kind: 'limit', quantity: 1, limitPrice: 99 });
    await settle();
    await ticket.amend(session.getOrder(orderId)!);
    await session.cancelOrder(orderId);
    await settle();
    expect(ticket.state.value).toMatchObject({
      mode: 'new',
      result: { level: 'info', message: `Order ${orderId} is cancelled; nothing left to change` },
    });
  });

  it('shows broker rejections and thrown errors', async () => {
    class RejectingBroker extends MockBroker {
      override submitOrder(request: OrderRequest, token?: string): Promise<string> {
        if (request.quantity === 13) return Promise.reject(new Error('Insufficient buying power'));
        return super.submitOrder({ ...request, quantity: request.quantity + 0.5 }, token);
      }
    }
    const { ticket } = await ticketSetup({ createBroker: (options) => new RejectingBroker(options) });
    const errors: string[] = [];
    ticket.on('error', (event) => errors.push(`${event.action}: ${event.message}`));

    expect(await ticket.submit()).toBe(false);
    ticket.setQuantity(13);
    expect(await ticket.submit()).toBe(false);
    expect(errors).toEqual([
      'submit: Order rejected: Quantity 1.5 is not a multiple of the quantity step',
      'submit: Insufficient buying power',
    ]);
    expect(ticket.state.value).toMatchObject({ phase: 'editing', result: { level: 'error', message: 'Insufficient buying power' } });
  });

  it('reports an acknowledgement timeout', async () => {
    // Updates arrive after 20 s, long after the 5 s acknowledgement deadline.
    const { context, feed } = await setupTrading({ broker: { latencyMs: 20_000 }, session: { ackTimeoutMs: 5_000 } });
    await feed.setQuote(ACME, { bid: 100, ask: 100.02 });
    const ticket = new OrderTicketController(context, { instrument: ACME });
    await ticket.ready;
    const submitting = ticket.submit();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(ticket.state.value.phase).toBe('submitting');
    await vi.advanceTimersByTimeAsync(1);
    expect(await submitting).toBe(false);
    expect(ticket.state.value.result).toEqual({
      level: 'error',
      message: 'The broker did not confirm the order within 5 s. Reloading trading state.',
    });
  });
});
