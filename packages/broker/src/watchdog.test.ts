import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrokerUpdate } from './contract';
import { BrokerSession } from './session';
import { ScriptedConnector } from './test-connector';
import { AckTimeoutError, AckWatchdog } from './watchdog';

const orderUpdate = (id: string, state: 'pending' | 'open' | 'cancelled'): BrokerUpdate => ({
  type: 'order',
  payload: { id, instrument: 'X', side: 'buy', kind: 'market', quantity: 1, state, filledQuantity: 0 },
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AckWatchdog', () => {
  it('reports a typed timeout when no matching update arrives in time', async () => {
    const onTimeout = vi.fn();
    const watchdog = new AckWatchdog({ onTimeout });
    const ack = watchdog.expect({
      action: 'cancel',
      targetId: 'o1',
      matches: (update, id) => update.type === 'order' && update.payload.id === id,
    });

    vi.advanceTimersByTime(9_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onTimeout).toHaveBeenCalledOnce();
    const error = onTimeout.mock.calls[0]![0] as AckTimeoutError;
    expect(error).toBeInstanceOf(AckTimeoutError);
    expect(error).toMatchObject({ name: 'AckTimeoutError', action: 'cancel', targetId: 'o1', timeoutMs: 10_000 });
    await expect(ack.outcome).resolves.toBe('timeout');
    expect(watchdog.pending).toHaveLength(0);
  });

  it('settles on a matching update and ignores others', async () => {
    const onTimeout = vi.fn();
    const watchdog = new AckWatchdog({ timeoutMs: 2_000, onTimeout });
    const ack = watchdog.expect({
      action: 'submit',
      matches: (update, id) => update.type === 'order' && update.payload.id === id && update.payload.state !== 'pending',
    });

    watchdog.observe(orderUpdate('o1', 'open'));
    ack.setTarget('o1');
    watchdog.observe(orderUpdate('o2', 'open'));
    watchdog.observe(orderUpdate('o1', 'pending'));
    expect(watchdog.pending).toHaveLength(1);
    watchdog.observe(orderUpdate('o1', 'open'));

    await expect(ack.outcome).resolves.toBe('acknowledged');
    vi.advanceTimersByTime(5_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('can be cancelled without a timeout', async () => {
    const onTimeout = vi.fn();
    const watchdog = new AckWatchdog({ onTimeout });
    const ack = watchdog.expect({ action: 'amend', targetId: 'o1', matches: () => false });
    ack.cancel();
    vi.advanceTimersByTime(20_000);
    await expect(ack.outcome).resolves.toBe('cancelled');
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('BrokerSession acknowledgements', () => {
  it('raises a timeout event and resyncs when the connector stays silent', async () => {
    const connector = new ScriptedConnector();
    const session = new BrokerSession(connector);
    await session.start();
    connector.silent = true;
    const timeouts: AckTimeoutError[] = [];
    session.on('timeout', (error) => timeouts.push(error));
    const resyncsBefore = connector.resyncs;

    const id = await session.submitOrder({ instrument: 'X', side: 'buy', kind: 'market', quantity: 1 });
    expect(session.pendingAcks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toMatchObject({ action: 'submit', targetId: id, timeoutMs: 10_000 });
    expect(connector.resyncs).toBe(resyncsBefore + 1);
    expect(session.pendingAcks).toHaveLength(0);
  });

  it('honours a custom deadline and stays quiet when updates arrive', async () => {
    const connector = new ScriptedConnector();
    const session = new BrokerSession(connector, { ackTimeoutMs: 3_000 });
    await session.start();
    const onTimeout = vi.fn();
    session.on('timeout', onTimeout);

    const id = await session.submitOrder({ instrument: 'X', side: 'buy', kind: 'limit', quantity: 1, limitPrice: 9 });
    await session.cancelOrder(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getOrder(id)?.state).toBe('cancelled');
    expect(session.pendingAcks).toHaveLength(0);

    connector.silent = true;
    await session.cancelOrder(id);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel', targetId: id, timeoutMs: 3_000 }));
  });

  it('does not wait for an acknowledgement when the request itself fails', async () => {
    const connector = new ScriptedConnector();
    connector.submitOrder = async () => {
      throw new Error('rejected by risk check');
    };
    const session = new BrokerSession(connector);
    await session.start();
    const onTimeout = vi.fn();
    session.on('timeout', onTimeout);

    await expect(session.submitOrder({ instrument: 'X', side: 'buy', kind: 'market', quantity: 1 })).rejects.toThrow(
      'rejected by risk check',
    );
    expect(session.pendingAcks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
