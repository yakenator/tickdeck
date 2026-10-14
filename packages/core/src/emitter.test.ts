import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter';

describe('Emitter', () => {
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

  it('runs a once-listener a single time', () => {
    const emitter = new Emitter<{ tick: number }>();
    const listener = vi.fn();
    emitter.once('tick', listener);

    emitter.emit('tick', 1);
    emitter.emit('tick', 2);

    expect(listener).toHaveBeenCalledExactlyOnceWith(1);
    expect(emitter.listenerCount('tick')).toBe(0);
  });

  it('keeps calling the remaining listeners when one throws, then rethrows', () => {
    const emitter = new Emitter<{ tick: number }>();
    const after = vi.fn();
    emitter.on('tick', () => {
      throw new Error('boom');
    });
    emitter.on('tick', after);

    expect(() => emitter.emit('tick', 1)).toThrow('boom');
    expect(after).toHaveBeenCalledWith(1);
  });

  it('aggregates several listener errors', () => {
    const emitter = new Emitter<{ tick: number }>();
    emitter.on('tick', () => {
      throw new Error('a');
    });
    emitter.on('tick', () => {
      throw new Error('b');
    });

    expect(() => emitter.emit('tick', 1)).toThrow(AggregateError);
  });

  it('tolerates unsubscribing during emit', () => {
    const emitter = new Emitter<{ tick: number }>();
    const second = vi.fn();
    const offFirst = emitter.on('tick', () => offFirst());
    emitter.on('tick', second);

    emitter.emit('tick', 1);
    emitter.emit('tick', 2);

    expect(second).toHaveBeenCalledTimes(2);
    expect(emitter.listenerCount()).toBe(1);
  });
});
