import { describe, expect, it } from 'vitest';
import { canTransition, checkOrderUpdate, isFinalState, isWorkingState } from './order-state';
import type { BrokerOrder, OrderState } from './types';

const order = (state: OrderState, filledQuantity = 0): BrokerOrder => ({
  id: 'o1',
  instrument: 'X',
  side: 'buy',
  kind: 'limit',
  quantity: 10,
  limitPrice: 100,
  state,
  filledQuantity,
});

describe('order state machine', () => {
  it('classifies working and final states', () => {
    expect(['pending', 'held', 'open'].every((s) => isWorkingState(s as OrderState))).toBe(true);
    expect(['filled', 'cancelled', 'rejected'].every((s) => isFinalState(s as OrderState))).toBe(true);
  });

  it.each<[OrderState, OrderState, boolean]>([
    ['pending', 'held', true],
    ['pending', 'open', true],
    ['pending', 'filled', true],
    ['pending', 'rejected', true],
    ['held', 'open', true],
    ['held', 'cancelled', true],
    ['held', 'filled', true],
    ['open', 'open', true],
    ['open', 'filled', true],
    ['open', 'cancelled', true],
    ['open', 'held', false],
    ['open', 'pending', false],
    ['held', 'pending', false],
    ['filled', 'open', false],
    ['filled', 'cancelled', false],
    ['cancelled', 'filled', false],
    ['rejected', 'open', false],
    ['filled', 'filled', true],
  ])('%s -> %s is %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it('flags lifecycle problems in updates', () => {
    expect(checkOrderUpdate(undefined, order('open'))).toBeUndefined();
    expect(checkOrderUpdate(order('open', 2), order('open', 5))).toBeUndefined();
    expect(checkOrderUpdate(order('filled', 10), order('open', 10))).toMatchObject({
      code: 'invalid-transition',
      from: 'filled',
      to: 'open',
    });
    expect(checkOrderUpdate(order('open', 5), order('open', 3))).toMatchObject({ code: 'fill-decreased' });
    expect(checkOrderUpdate(undefined, order('filled', 11))).toMatchObject({ code: 'overfilled' });
  });
});
