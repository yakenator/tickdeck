import { describe, expect, it, vi } from 'vitest';
import type { OrderUpdateProblem } from './order-state';
import type { BrokerUpdateSink } from './contract';
import { BrokerError, BrokerSession } from './session';
import { ScriptedConnector } from './test-connector';
import type { BrokerConnectionState, BrokerOrder, BrokerPosition } from './types';

/** A connector whose `connect` waits until the test lets it finish or fail. */
class GatedConnector extends ScriptedConnector {
  finish: () => void = () => {};
  fail: (error: Error) => void = () => {};
  disconnects = 0;

  override connect(sink: BrokerUpdateSink): Promise<void> {
    this.sink = sink;
    return new Promise((resolve, reject) => {
      this.finish = resolve;
      this.fail = reject;
    });
  }

  async disconnect(): Promise<void> {
    this.disconnects++;
  }
}

const flush = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};

const position: BrokerPosition = { id: 'p1', instrument: 'X', side: 'buy', quantity: 5, averagePrice: 10 };

describe('BrokerSession', () => {
  it('loads capabilities, accounts and state on start', async () => {
    const connector = new ScriptedConnector();
    connector.capabilities = { positionExits: true };
    connector.positions = [position, { ...position, id: 'p0', quantity: 0 }];
    const session = new BrokerSession(connector);

    await session.start();

    expect(session.connection.value.state).toBe('connected');
    expect(session.activeAccountId.value).toBe('acc');
    expect(session.accounts).toHaveLength(1);
    expect(session.capabilities).toMatchObject({ positionExits: true, orderExits: false, emulation: true });
    expect(session.positions.map((p) => p.id)).toEqual(['p1']);
  });

  it('applies updates and ignores ones that break the order lifecycle', async () => {
    const connector = new ScriptedConnector();
    const session = new BrokerSession(connector);
    await session.start();
    const violations: OrderUpdateProblem[] = [];
    const orders: BrokerOrder[] = [];
    session.on('violation', (problem) => violations.push(problem));
    session.on('order', (order) => orders.push(order));
    const base: BrokerOrder = { id: 'o1', instrument: 'X', side: 'buy', kind: 'market', quantity: 2, state: 'open', filledQuantity: 0 };

    connector.sink!.emit('order', base);
    connector.sink!.emit('order', { ...base, state: 'filled', filledQuantity: 2 });
    connector.sink!.emit('order', { ...base, state: 'open', filledQuantity: 2 });

    expect(orders.map((o) => o.state)).toEqual(['open', 'filled']);
    expect(session.getOrder('o1')?.state).toBe('filled');
    expect(violations).toEqual([expect.objectContaining({ code: 'invalid-transition', from: 'filled', to: 'open' })]);
  });

  it('tracks positions, P&L and balance from updates', async () => {
    const connector = new ScriptedConnector();
    const session = new BrokerSession(connector);
    await session.start();
    const balances = vi.fn();
    session.balance.subscribe(balances);

    connector.sink!.emit('position', position);
    connector.sink!.emit('pnl', { positionId: 'p1', unrealizedPnl: 2.5, lastPrice: 10.5 });
    connector.sink!.emit('balance', {
      accountId: 'acc',
      currency: 'USD',
      balance: 1000,
      equity: 1002.5,
      unrealizedPnl: 2.5,
      realizedPnl: 0,
    });
    expect(session.getPosition('p1')).toMatchObject({ unrealizedPnl: 2.5, lastPrice: 10.5 });
    expect(balances).toHaveBeenCalledOnce();

    connector.sink!.emit('position', { ...position, quantity: 0 });
    expect(session.positions).toEqual([]);
  });

  it('emulates close and reverse with market orders when the broker lacks them', async () => {
    const connector = new ScriptedConnector();
    connector.positions = [position];
    const session = new BrokerSession(connector);
    await session.start();

    await session.closePosition('p1', 2);
    await session.reversePosition('p1');
    await flush();

    expect(connector.submitted).toEqual([
      { instrument: 'X', side: 'sell', kind: 'market', quantity: 2, reduceOnly: true },
      { instrument: 'X', side: 'sell', kind: 'market', quantity: 10 },
    ]);
  });

  it('refuses unsupported actions with BrokerError', async () => {
    const connector = new ScriptedConnector();
    connector.capabilities = { emulation: false };
    connector.positions = [position];
    const session = new BrokerSession(connector);

    await expect(session.cancelOrder('o1')).rejects.toMatchObject({ code: 'not-started' });
    await session.start();
    await expect(session.closePosition('p1')).rejects.toBeInstanceOf(BrokerError);
    await expect(session.setPositionExits('p1', { stopLoss: 9 })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(session.reversePosition('nope')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('replaces its view on a pushed resync', async () => {
    const connector = new ScriptedConnector();
    const session = new BrokerSession(connector);
    await session.start();
    const onResync = vi.fn();
    session.on('resync', onResync);

    connector.sink!.emit('resync', { positions: [position], orders: [] });

    expect(session.positions).toEqual([position]);
    expect(onResync).toHaveBeenCalledOnce();
  });

  it('reads connecting while the connector connects', async () => {
    const connector = new GatedConnector();
    const session = new BrokerSession(connector);
    const states: BrokerConnectionState[] = [];
    session.connection.subscribe((connection) => states.push(connection.state));

    const started = session.start();
    expect(session.connection.value).toEqual({ state: 'connecting' });
    connector.sink!.emit('connection', { state: 'connecting', message: 'Signing in' });
    expect(session.connection.value).toEqual({ state: 'connecting', message: 'Signing in' });

    connector.finish();
    await started;
    expect(session.connection.value.state).toBe('connected');
    expect(states).toEqual(['connecting', 'connecting', 'connected']);
  });

  it('reads error when connecting fails, and can start again', async () => {
    const connector = new GatedConnector();
    const session = new BrokerSession(connector);
    const started = session.start();
    connector.fail(new Error('Network down'));

    await expect(started).rejects.toThrow('Network down');
    expect(session.connection.value).toEqual({ state: 'error', message: 'Network down' });
    expect(connector.disconnects).toBe(0);
    await expect(session.submitOrder({ instrument: 'X', side: 'buy', kind: 'market', quantity: 1 })).rejects.toThrow(BrokerError);

    const again = session.start();
    expect(session.connection.value.state).toBe('connecting');
    connector.finish();
    await again;
    expect(session.connection.value.state).toBe('connected');
  });

  it('disconnects again when loading the account fails after connecting', async () => {
    const connector = new GatedConnector();
    connector.listAccounts = () => Promise.reject(new Error('No accounts'));
    const session = new BrokerSession(connector);
    const started = session.start();
    connector.finish();

    await expect(started).rejects.toThrow('No accounts');
    expect(connector.disconnects).toBe(1);
    expect(session.connection.value).toEqual({ state: 'error', message: 'No accounts' });
  });
});
