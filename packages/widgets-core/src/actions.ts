import {
  AckTimeoutError,
  BrokerError,
  DEFAULT_ACK_TIMEOUT_MS,
  type AckOutcome,
  type BrokerAction,
  type BrokerOrder,
  type BrokerSession,
  type OrderRequest,
} from '@tickdeck/broker';

/** The broker took an order but rejected it (`state: 'rejected'`). */
export class OrderRejectedError extends Error {
  override readonly name = 'OrderRejectedError';
  readonly orderId: string;
  readonly order: BrokerOrder | undefined;

  constructor(orderId: string, order?: BrokerOrder) {
    super(order?.message ? `Order rejected: ${order.message}` : 'Order rejected');
    this.orderId = orderId;
    this.order = order;
  }
}

const ACTION_NAMES: Record<BrokerAction, string> = {
  submit: 'order',
  amend: 'change',
  cancel: 'cancellation',
  close: 'close',
  reverse: 'reversal',
  'set-exits': 'exit change',
};

/** A short message for the user, for any error a trading action can raise. */
export function describeTradingError(error: unknown): string {
  if (error instanceof AckTimeoutError) {
    const seconds = Math.round(error.timeoutMs / 100) / 10;
    return `The broker did not confirm the ${ACTION_NAMES[error.action]} within ${seconds} s. Reloading trading state.`;
  }
  if (error instanceof BrokerError) {
    if (error.code === 'not-started') return 'Not connected to the broker';
    return error.message;
  }
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * Waits until the session saw the update that confirms an action, or until
 * its deadline passed. Returns the session's `AckTimeoutError` on timeout.
 */
export async function awaitAcknowledgement(
  session: BrokerSession,
  action: BrokerAction,
  targetId: string,
): Promise<{ outcome: AckOutcome; error?: AckTimeoutError }> {
  const pending = session.pendingAcks.find((ack) => ack.action === action && ack.targetId === targetId);
  if (!pending) return { outcome: 'acknowledged' };
  let error: AckTimeoutError | undefined;
  const off = session.on('timeout', (timeout) => {
    if (timeout.action === action && timeout.targetId === targetId) error = timeout;
  });
  try {
    const outcome = await pending.outcome;
    if (outcome !== 'timeout') return { outcome };
    return { outcome, error: error ?? new AckTimeoutError(action, targetId, DEFAULT_ACK_TIMEOUT_MS) };
  } finally {
    off();
  }
}

/**
 * Submits an order and resolves once the broker confirmed it. Rejects with
 * `AckTimeoutError` when no confirmation arrived in time and with
 * `OrderRejectedError` when the broker rejected the order.
 */
export async function placeOrder(
  session: BrokerSession,
  request: OrderRequest,
  confirmationToken?: string,
): Promise<{ orderId: string; order: BrokerOrder | undefined }> {
  const orderId = await session.submitOrder(request, confirmationToken);
  const { outcome, error } = await awaitAcknowledgement(session, 'submit', orderId);
  if (outcome === 'timeout') throw error;
  const order = session.getOrder(orderId);
  if (order?.state === 'rejected') throw new OrderRejectedError(orderId, order);
  return { orderId, order };
}

/** Runs an order or position action and waits for its confirmation. */
export async function runAcknowledged(
  session: BrokerSession,
  action: BrokerAction,
  targetId: string,
  call: () => Promise<void>,
): Promise<void> {
  await call();
  const { outcome, error } = await awaitAcknowledgement(session, action, targetId);
  if (outcome === 'timeout') throw error;
}
