import { expect, it, vi } from 'vitest';
import { Emitter } from './emitter';

it('delivers payloads until the listener unsubscribes', () => {
  const emitter = new Emitter<{ tick: number }>();
  const listener = vi.fn();
  const off = emitter.on('tick', listener);

  emitter.emit('tick', 1);
  off();
  emitter.emit('tick', 2);

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(1);
});
