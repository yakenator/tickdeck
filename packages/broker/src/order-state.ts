import type { BrokerOrder, OrderState } from './types';

export const WORKING_ORDER_STATES: readonly OrderState[] = ['pending', 'held', 'open'];
export const FINAL_ORDER_STATES: readonly OrderState[] = ['filled', 'cancelled', 'rejected'];

const RANK: Record<OrderState, number> = {
  pending: 0,
  held: 1,
  open: 2,
  filled: 3,
  cancelled: 3,
  rejected: 3,
};

export function isWorkingState(state: OrderState): boolean {
  return RANK[state] < 3;
}

export function isFinalState(state: OrderState): boolean {
  return RANK[state] === 3;
}

/**
 * Whether an order may move from `from` to `to`. Orders only move forward:
 * `pending` → `held` → `open` → a final state, and any step may be skipped.
 * Repeating the current state is allowed (field updates, partial fills). A
 * final state never changes.
 */
export function canTransition(from: OrderState, to: OrderState): boolean {
  if (from === to) return true;
  if (isFinalState(from)) return false;
  return RANK[to] > RANK[from];
}

export type OrderUpdateProblemCode = 'invalid-transition' | 'fill-decreased' | 'overfilled';

export interface OrderUpdateProblem {
  code: OrderUpdateProblemCode;
  orderId: string;
  message: string;
  from?: OrderState;
  to?: OrderState;
}

/**
 * Checks an order update against the previous version of the same order.
 * Returns the problem that makes the update invalid, or `undefined`.
 */
export function checkOrderUpdate(previous: BrokerOrder | undefined, next: BrokerOrder): OrderUpdateProblem | undefined {
  if (next.filledQuantity > next.quantity) {
    return {
      code: 'overfilled',
      orderId: next.id,
      message: `Order ${next.id} reports ${next.filledQuantity} filled of ${next.quantity}`,
    };
  }
  if (!previous) return undefined;
  if (!canTransition(previous.state, next.state)) {
    return {
      code: 'invalid-transition',
      orderId: next.id,
      from: previous.state,
      to: next.state,
      message: `Order ${next.id} cannot move from ${previous.state} to ${next.state}`,
    };
  }
  if (next.filledQuantity < previous.filledQuantity) {
    return {
      code: 'fill-decreased',
      orderId: next.id,
      message: `Order ${next.id} filled quantity went from ${previous.filledQuantity} to ${next.filledQuantity}`,
    };
  }
  return undefined;
}
