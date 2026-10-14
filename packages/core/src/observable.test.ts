import { describe, expect, it, vi } from 'vitest';
import { DisposableGroup, toDisposable } from './disposable';
import { ObservableValue } from './observable';

describe('ObservableValue', () => {
  it('notifies with the new and previous value only when the value changes', () => {
    const balance = new ObservableValue(100);
    const listener = vi.fn();
    balance.subscribe(listener);

    balance.set(100);
    balance.set(120);
    balance.update((value) => value + 5);

    expect(listener.mock.calls).toEqual([
      [120, 100],
      [125, 120],
    ]);
    expect(balance.value).toBe(125);
  });

  it('supports a custom equality check and emitting the current value', () => {
    const state = new ObservableValue({ status: 'connecting' }, { equals: (a, b) => a.status === b.status });
    const listener = vi.fn();
    state.subscribe(listener, { emitCurrent: true });

    state.set({ status: 'connecting' });
    state.set({ status: 'connected' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ status: 'connected' }, { status: 'connecting' });
  });

  it('exposes a read-only view that follows the source', () => {
    const source = new ObservableValue('a');
    const view = source.asReadonly();
    const listener = vi.fn();
    const off = view.subscribe(listener);

    source.set('b');
    off();
    source.set('c');

    expect(view.value).toBe('c');
    expect(listener).toHaveBeenCalledExactlyOnceWith('b', 'a');
    expect('set' in view).toBe(false);
  });
});

describe('DisposableGroup', () => {
  it('disposes everything newest first, once', () => {
    const order: string[] = [];
    const group = new DisposableGroup();
    group.add(() => order.push('unsubscribe'));
    group.add(toDisposable(() => order.push('disposable')));

    group.dispose();
    group.dispose();

    expect(order).toEqual(['disposable', 'unsubscribe']);
    expect(group.disposed).toBe(true);
  });

  it('disposes items added after disposal immediately', () => {
    const group = new DisposableGroup();
    group.dispose();
    const cleanup = vi.fn();

    group.add(cleanup);

    expect(cleanup).toHaveBeenCalledOnce();
  });
});
