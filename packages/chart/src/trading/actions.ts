import type { BrokerSession, OrderAmendment, ProtectiveExits, ResolvedBrokerCapabilities } from '@tickdeck/broker';
import type { TradingLine, TradingLineEdit, TradingLineTarget } from './scene';

/** A broker call started from the chart. */
export type TradingAction =
  | { type: 'amend-order'; orderId: string; changes: OrderAmendment }
  | { type: 'cancel-order'; orderId: string }
  | { type: 'set-position-exits'; positionId: string; exits: ProtectiveExits }
  | { type: 'close-position'; positionId: string };

type Capabilities = Pick<ResolvedBrokerCapabilities, 'amendOrders' | 'positionExits'>;

const EXIT_FIELD = { 'take-profit': 'takeProfit', 'stop-loss': 'stopLoss' } as const;
const EXIT_PRICE_FIELD = { 'take-profit': 'limitPrice', 'stop-loss': 'stopPrice' } as const;

/**
 * The broker call that moves a line to `price`, or `undefined` when the line
 * cannot move. Orders are amended; exits of an entry order are amended on the
 * entry; exits of a position use `setPositionExits` when the broker supports
 * it, otherwise the exit order is amended.
 */
export function planLineMove(line: TradingLine, price: number, capabilities: Capabilities): TradingAction | undefined {
  if (!line.draggable) return undefined;
  const target = line.target;
  switch (target.type) {
    case 'order':
      return { type: 'amend-order', orderId: target.orderId, changes: { [target.field]: price } };
    case 'order-exit':
      return { type: 'amend-order', orderId: target.entryOrderId, changes: { [EXIT_FIELD[target.role]]: price } };
    case 'position-exit':
      if (capabilities.positionExits) {
        return { type: 'set-position-exits', positionId: target.positionId, exits: { [EXIT_FIELD[target.role]]: price } };
      }
      if (target.exitOrderId !== undefined && capabilities.amendOrders) {
        return { type: 'amend-order', orderId: target.exitOrderId, changes: { [EXIT_PRICE_FIELD[target.role]]: price } };
      }
      return undefined;
    case 'position':
      return undefined;
  }
}

/**
 * The broker call behind a line's cancel or close button: cancel the order,
 * remove the exit (`null` on the entry or position, or cancel the exit
 * order), or close the position.
 */
export function planLineRemoval(line: TradingLine, capabilities: Capabilities): TradingAction | undefined {
  if (!line.removable) return undefined;
  const target = line.target;
  switch (target.type) {
    case 'order':
      return { type: 'cancel-order', orderId: target.orderId };
    case 'order-exit':
      return { type: 'amend-order', orderId: target.entryOrderId, changes: { [EXIT_FIELD[target.role]]: null } };
    case 'position-exit':
      if (capabilities.positionExits) {
        return { type: 'set-position-exits', positionId: target.positionId, exits: { [EXIT_FIELD[target.role]]: null } };
      }
      return target.exitOrderId === undefined ? undefined : { type: 'cancel-order', orderId: target.exitOrderId };
    case 'position':
      return { type: 'close-position', positionId: target.positionId };
  }
}

/** Sends an action through the session. */
export function runTradingAction(session: BrokerSession, action: TradingAction): Promise<void> {
  switch (action.type) {
    case 'amend-order':
      return session.amendOrder(action.orderId, action.changes);
    case 'cancel-order':
      return session.cancelOrder(action.orderId);
    case 'set-position-exits':
      return session.setPositionExits(action.positionId, action.exits);
    case 'close-position':
      return session.closePosition(action.positionId);
  }
}

/** Order and position ids whose updates concern a line. */
export function lineTargetIds(target: TradingLineTarget): string[] {
  switch (target.type) {
    case 'order':
      return [target.orderId];
    case 'order-exit':
      return target.exitOrderId === undefined ? [target.entryOrderId] : [target.entryOrderId, target.exitOrderId];
    case 'position-exit':
      return target.exitOrderId === undefined ? [target.positionId] : [target.positionId, target.exitOrderId];
    case 'position':
      return [target.positionId];
  }
}

interface PendingEdit extends TradingLineEdit {
  targets: readonly string[];
  /** The broker call resolved. */
  settled: boolean;
  /** An update for one of the targets arrived since the edit began. */
  answered: boolean;
}

/**
 * Changes made from the chart that the broker has not confirmed yet. A
 * dragged line keeps its new price, and a line being cancelled or closed
 * stays marked, until the broker's state catches up:
 *
 * - the line shows the requested price (or is gone) in the broker's state;
 * - the call resolved and an update for the order or position arrived (the
 *   broker answered, perhaps with another price);
 * - the call failed, or the acknowledgement deadline passed.
 */
export class TradingEdits {
  readonly #edits = new Map<string, PendingEdit>();

  get size(): number {
    return this.#edits.size;
  }

  /** The edits as the scene builder takes them. */
  get view(): ReadonlyMap<string, TradingLineEdit> {
    return this.#edits;
  }

  has(lineId: string): boolean {
    return this.#edits.has(lineId);
  }

  begin(lineId: string, edit: TradingLineEdit, targets: readonly string[]): void {
    this.#edits.set(lineId, { ...edit, targets, settled: false, answered: false });
  }

  /** The broker call resolved. */
  settle(lineId: string): void {
    const edit = this.#edits.get(lineId);
    if (edit) edit.settled = true;
  }

  /** The broker call failed: the line goes back to the broker's state. */
  fail(lineId: string): void {
    this.#edits.delete(lineId);
  }

  /** Updates arrived for these order or position ids, or for everything when omitted (a resync). */
  touch(ids?: Iterable<string>): void {
    const touched = ids === undefined ? undefined : new Set(ids);
    for (const edit of this.#edits.values()) {
      if (!touched || edit.targets.some((id) => touched.has(id))) edit.answered = true;
    }
  }

  /** The acknowledgement deadline for `targetId` passed. Returns the line ids dropped. */
  expire(targetId: string): string[] {
    const dropped: string[] = [];
    for (const [lineId, edit] of this.#edits) {
      if (edit.targets.includes(targetId)) {
        this.#edits.delete(lineId);
        dropped.push(lineId);
      }
    }
    return dropped;
  }

  /** Drops the edits the broker's state has caught up with. `lines` is the scene built without edits. */
  reconcile(lines: readonly TradingLine[]): void {
    for (const [lineId, edit] of this.#edits) {
      const line = lines.find((candidate) => candidate.id === lineId);
      const caughtUp = !line || (edit.price !== undefined && line.price === edit.price);
      if (caughtUp || (edit.settled && edit.answered)) this.#edits.delete(lineId);
    }
  }

  clear(): void {
    this.#edits.clear();
  }
}
