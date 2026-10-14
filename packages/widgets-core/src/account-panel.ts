import {
  isFinalState,
  isWorkingState,
  type AccountBalance,
  type BrokerOrder,
  type BrokerPosition,
  type Fill,
  type ProtectiveExits,
} from '@tickdeck/broker';
import { checkQuantity, type QuantityProblem } from '@tickdeck/core';
import { describeTradingError, runAcknowledged } from './actions';
import type { WidgetContext } from './context';
import { WidgetController } from './controller';
import { formatAmount, formatTimeOfDay, moneyPrecision } from './format';
import { InstrumentFormat, getInstrumentResolver, type InstrumentResolver, type TradableInstrument } from './instrument';
import {
  EXIT_ROLE_LABELS,
  ORDER_KIND_LABELS,
  ORDER_STATE_LABELS,
  POSITION_SIDE_LABELS,
  SIDE_LABELS,
  TIME_IN_FORCE_LABELS,
} from './labels';

export type AccountTab = 'orders' | 'positions' | 'fills';
export type OrderFilter = 'working' | 'all';
export type SortDirection = 'asc' | 'desc';
/** `connecting` while the session connects, `loading` until the account's orders, positions and fills are in. */
export type PanelStatus = 'connecting' | 'loading' | 'ready' | 'disconnected';
/** Colour hint for a cell: trade direction, sign of a P&L, or de-emphasis. */
export type CellTone = 'buy' | 'sell' | 'positive' | 'negative' | 'muted';
export type PanelAction = 'cancel' | 'close' | 'reverse' | 'set-exits';

export interface SortOrder {
  column: string;
  direction: SortDirection;
}

export interface PanelColumn {
  id: string;
  label: string;
  /** Right-aligned numbers. */
  numeric: boolean;
}

/** One table row: the broker object plus display text and tones per column id. */
export interface PanelRow<T> {
  id: string;
  item: T;
  cells: Readonly<Record<string, string>>;
  tones: Readonly<Record<string, CellTone | undefined>>;
  /** Short description for labels, e.g. `Buy 10 ACME Limit 99.50`. */
  label: string;
  /** An action on this row is waiting for the broker. */
  busy: boolean;
}

export interface OrderRow extends PanelRow<BrokerOrder> {
  /** Entry order this protective exit waits for, when that order is listed too. Such rows follow their entry. */
  parentId?: string;
  working: boolean;
  canCancel: boolean;
  canAmend: boolean;
}

export interface PositionRow extends PanelRow<BrokerPosition> {
  canClose: boolean;
  canPartialClose: boolean;
  canReverse: boolean;
  canEditExits: boolean;
}

export type FillRow = PanelRow<Fill>;

export interface SummaryItem {
  id: 'balance' | 'equity' | 'unrealized-pnl' | 'realized-pnl' | 'margin-used' | 'margin-available';
  label: string;
  value: number;
  text: string;
  tone?: CellTone;
}

export interface AccountSummary {
  accountId: string;
  accountName?: string;
  currency: string;
  balance: AccountBalance;
  items: readonly SummaryItem[];
}

/** A position close being entered, possibly for part of the position. */
export interface CloseDraft {
  positionId: string;
  quantity: number | undefined;
  /** The full position size. */
  maximum: number;
  error?: string;
}

export interface AccountPanelState {
  status: PanelStatus;
  /** Connection message from the broker, while connecting or when disconnected. */
  message?: string;
  tab: AccountTab;
  orderFilter: OrderFilter;
  sort: Readonly<Record<AccountTab, SortOrder>>;
  columns: Readonly<Record<AccountTab, readonly PanelColumn[]>>;
  summary?: AccountSummary;
  orders: readonly OrderRow[];
  positions: readonly PositionRow[];
  fills: readonly FillRow[];
  /** Working orders, open positions and listed fills. */
  counts: Readonly<Record<AccountTab, number>>;
  closing?: CloseDraft;
  /** Message of the last failed action. */
  error?: string;
}

export interface AccountPanelEvents {
  /** The user wants to change a working order. Open an order ticket in amend mode. */
  amend: BrokerOrder;
  /** The user wants to change the take-profit or stop-loss of a position. */
  'edit-exits': BrokerPosition;
  'action-error': { action: PanelAction; targetId: string; error: unknown; message: string };
}

export interface AccountPanelOptions {
  tab?: AccountTab;
  orderFilter?: OrderFilter;
  /** Most fills listed, newest first. Default 200. */
  fillLimit?: number;
}

interface CellContext {
  now: number;
  timeZone: string | undefined;
}

interface ColumnDef<T> extends PanelColumn {
  sortValue(item: T, format: InstrumentFormat): string | number | undefined;
  cell(item: T, format: InstrumentFormat, context: CellContext): string;
  tone?(item: T): CellTone | undefined;
  /** Initial direction when sorting by this column. */
  descending?: boolean;
}

const pnlTone = (value: number | undefined): CellTone | undefined =>
  value === undefined || value === 0 ? undefined : value > 0 ? 'positive' : 'negative';

const instrumentColumn = <T extends { instrument: string }>(): ColumnDef<T> => ({
  id: 'instrument',
  label: 'Instrument',
  numeric: false,
  sortValue: (item, format) => format.name || item.instrument,
  cell: (item, format) => format.name || item.instrument,
});

function orderPrice(order: BrokerOrder): number | undefined {
  switch (order.kind) {
    case 'market':
      return order.averageFillPrice;
    case 'limit':
      return order.limitPrice;
    case 'stop':
    case 'stop-limit':
      return order.stopPrice;
  }
}

function orderPriceText(order: BrokerOrder, format: InstrumentFormat): string {
  switch (order.kind) {
    case 'market':
      return order.averageFillPrice === undefined ? 'Market' : format.price(order.averageFillPrice);
    case 'limit':
      return format.price(order.limitPrice);
    case 'stop':
      return format.price(order.stopPrice);
    case 'stop-limit':
      return `${format.price(order.stopPrice)} / ${format.price(order.limitPrice)}`;
  }
}

function orderStateText(order: BrokerOrder): string {
  if (order.state === 'open' && order.filledQuantity > 0) return 'Partly filled';
  return ORDER_STATE_LABELS[order.state];
}

const STATE_RANK = { pending: 0, held: 1, open: 2, filled: 3, cancelled: 4, rejected: 5 } as const;

const ORDER_COLUMNS: readonly ColumnDef<BrokerOrder>[] = [
  {
    id: 'time',
    label: 'Time',
    numeric: false,
    descending: true,
    sortValue: (order) => order.updatedAt,
    cell: (order, _format, context) => formatTimeOfDay(order.updatedAt, context.now, context.timeZone),
  },
  instrumentColumn(),
  {
    id: 'side',
    label: 'Side',
    numeric: false,
    sortValue: (order) => order.side,
    cell: (order) => SIDE_LABELS[order.side],
    tone: (order) => order.side,
  },
  {
    id: 'type',
    label: 'Type',
    numeric: false,
    sortValue: (order) => (order.exitRole ? EXIT_ROLE_LABELS[order.exitRole] : ORDER_KIND_LABELS[order.kind]),
    cell: (order) => (order.exitRole ? EXIT_ROLE_LABELS[order.exitRole] : ORDER_KIND_LABELS[order.kind]),
  },
  {
    id: 'quantity',
    label: 'Quantity',
    numeric: true,
    sortValue: (order) => order.quantity,
    cell: (order, format) =>
      order.filledQuantity > 0 && order.filledQuantity < order.quantity
        ? `${format.quantity(order.filledQuantity)} / ${format.quantity(order.quantity)}`
        : format.quantity(order.quantity),
  },
  {
    id: 'price',
    label: 'Price',
    numeric: true,
    sortValue: orderPrice,
    cell: orderPriceText,
  },
  {
    id: 'exits',
    label: 'TP / SL',
    numeric: true,
    sortValue: (order) => order.takeProfit ?? order.stopLoss,
    cell: (order, format) =>
      [
        order.takeProfit === undefined ? '' : `TP ${format.price(order.takeProfit)}`,
        order.stopLoss === undefined ? '' : `SL ${format.price(order.stopLoss)}`,
      ]
        .filter(Boolean)
        .join(' · '),
  },
  {
    id: 'tif',
    label: 'TIF',
    numeric: false,
    sortValue: (order) => order.timeInForce,
    cell: (order) => (order.timeInForce ? TIME_IN_FORCE_LABELS[order.timeInForce] : ''),
  },
  {
    id: 'status',
    label: 'Status',
    numeric: false,
    sortValue: (order) => STATE_RANK[order.state],
    cell: orderStateText,
    tone: (order) => (order.state === 'rejected' ? 'negative' : isFinalState(order.state) ? 'muted' : undefined),
  },
];

const POSITION_COLUMNS: readonly ColumnDef<BrokerPosition>[] = [
  instrumentColumn(),
  {
    id: 'side',
    label: 'Side',
    numeric: false,
    sortValue: (position) => position.side,
    cell: (position) => POSITION_SIDE_LABELS[position.side],
    tone: (position) => position.side,
  },
  {
    id: 'quantity',
    label: 'Quantity',
    numeric: true,
    sortValue: (position) => position.quantity,
    cell: (position, format) => format.quantity(position.quantity),
  },
  {
    id: 'average',
    label: 'Avg price',
    numeric: true,
    sortValue: (position) => position.averagePrice,
    cell: (position, format) => format.price(position.averagePrice),
  },
  {
    id: 'last',
    label: 'Last',
    numeric: true,
    sortValue: (position) => position.lastPrice,
    cell: (position, format) => format.price(position.lastPrice),
  },
  {
    id: 'unrealized',
    label: 'Unrealized P&L',
    numeric: true,
    descending: true,
    sortValue: (position) => position.unrealizedPnl,
    cell: (position, format) => format.money(position.unrealizedPnl, true),
    tone: (position) => pnlTone(position.unrealizedPnl),
  },
  {
    id: 'realized',
    label: 'Realized P&L',
    numeric: true,
    descending: true,
    sortValue: (position) => position.realizedPnl,
    cell: (position, format) => format.money(position.realizedPnl, true),
    tone: (position) => pnlTone(position.realizedPnl),
  },
  {
    id: 'take-profit',
    label: 'Take-profit',
    numeric: true,
    sortValue: (position) => position.takeProfit,
    cell: (position, format) => format.price(position.takeProfit),
  },
  {
    id: 'stop-loss',
    label: 'Stop-loss',
    numeric: true,
    sortValue: (position) => position.stopLoss,
    cell: (position, format) => format.price(position.stopLoss),
  },
];

const FILL_COLUMNS: readonly ColumnDef<Fill>[] = [
  {
    id: 'time',
    label: 'Time',
    numeric: false,
    descending: true,
    sortValue: (fill) => fill.time,
    cell: (fill, _format, context) => formatTimeOfDay(fill.time, context.now, context.timeZone),
  },
  instrumentColumn(),
  {
    id: 'side',
    label: 'Side',
    numeric: false,
    sortValue: (fill) => fill.side,
    cell: (fill) => SIDE_LABELS[fill.side],
    tone: (fill) => fill.side,
  },
  {
    id: 'quantity',
    label: 'Quantity',
    numeric: true,
    sortValue: (fill) => fill.quantity,
    cell: (fill, format) => format.quantity(fill.quantity),
  },
  {
    id: 'price',
    label: 'Price',
    numeric: true,
    sortValue: (fill) => fill.price,
    cell: (fill, format) => format.price(fill.price),
  },
  {
    id: 'commission',
    label: 'Commission',
    numeric: true,
    sortValue: (fill) => fill.commission,
    cell: (fill, format) => format.money(fill.commission),
  },
  {
    id: 'realized',
    label: 'Realized P&L',
    numeric: true,
    descending: true,
    sortValue: (fill) => fill.realizedPnl,
    cell: (fill, format) => (fill.realizedPnl ? format.money(fill.realizedPnl, true) : ''),
    tone: (fill) => pnlTone(fill.realizedPnl),
  },
];

const COLUMN_DEFS = { orders: ORDER_COLUMNS, positions: POSITION_COLUMNS, fills: FILL_COLUMNS } as const;

const publicColumns = (defs: readonly ColumnDef<never>[]): PanelColumn[] =>
  defs.map(({ id, label, numeric }) => ({ id, label, numeric }));

const COLUMNS: Readonly<Record<AccountTab, readonly PanelColumn[]>> = {
  orders: publicColumns(ORDER_COLUMNS),
  positions: publicColumns(POSITION_COLUMNS),
  fills: publicColumns(FILL_COLUMNS),
};

const DEFAULT_SORT: Readonly<Record<AccountTab, SortOrder>> = {
  orders: { column: 'time', direction: 'desc' },
  positions: { column: 'instrument', direction: 'asc' },
  fills: { column: 'time', direction: 'desc' },
};

const QUANTITY_PROBLEMS: Record<QuantityProblem, (rules: { min: number; max?: number; step: number }, format: InstrumentFormat) => string> = {
  'not-finite': () => 'Enter a number',
  'not-positive': () => 'Quantity must be positive',
  'below-min': (rules, format) => `Minimum is ${format.quantity(rules.min)}`,
  'above-max': (rules, format) => `At most ${format.quantity(rules.max)}`,
  'off-step': (rules, format) => `Use steps of ${format.quantity(rules.step)}`,
};

function compareValues(a: string | number | undefined, b: string | number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Orders, positions and fills of the active account, with an account
 * summary, sorting, filtering and row actions (cancel, amend, close,
 * reverse, edit exits). Reads everything from the `BrokerSession`.
 */
export class AccountPanelController extends WidgetController<AccountPanelState, AccountPanelEvents> {
  readonly #resolver: InstrumentResolver;
  readonly #fillLimit: number;
  readonly #busy = new Set<string>();
  readonly #waiting = new Set<Promise<TradableInstrument>>();
  readonly #failed = new Set<string>();
  #loaded: boolean;

  constructor(context: WidgetContext, options: AccountPanelOptions = {}) {
    super(context, {
      status: 'loading',
      tab: options.tab ?? 'orders',
      orderFilter: options.orderFilter ?? 'working',
      sort: DEFAULT_SORT,
      columns: COLUMNS,
      orders: [],
      positions: [],
      fills: [],
      counts: { orders: 0, positions: 0, fills: 0 },
    });
    this.#resolver = getInstrumentResolver(context);
    this.#fillLimit = options.fillLimit ?? 200;
    const session = context.session;
    this.#loaded = session.activeAccountId.value !== undefined;
    const refresh = () => this.#refresh();
    for (const event of ['order', 'position', 'fill', 'pnl'] as const) this.disposables.add(session.on(event, refresh));
    this.disposables.add(
      session.on('resync', () => {
        this.#loaded = true;
        this.#refresh();
      }),
    );
    this.disposables.add(
      session.on('account', () => {
        this.#loaded = false;
        this.#failed.clear();
        this.#refresh();
      }),
    );
    this.disposables.add(session.balance.subscribe(refresh));
    this.disposables.add(session.connection.subscribe(refresh));
    this.#refresh();
  }

  protected override timeZoneChanged(): void {
    this.#refresh();
  }

  setTab(tab: AccountTab): void {
    if (tab !== this.state.value.tab) this.#refresh({ tab });
  }

  setOrderFilter(orderFilter: OrderFilter): void {
    if (orderFilter !== this.state.value.orderFilter) this.#refresh({ orderFilter });
  }

  /** Sorts a tab by a column. Sorting by the current column again flips the direction. */
  sortBy(column: string, tab: AccountTab = this.state.value.tab): void {
    const def = (COLUMN_DEFS[tab] as readonly ColumnDef<never>[]).find((candidate) => candidate.id === column);
    if (!def) return;
    const current = this.state.value.sort[tab];
    const direction: SortDirection =
      current.column === column ? (current.direction === 'asc' ? 'desc' : 'asc') : def.descending ? 'desc' : 'asc';
    this.#refresh({ sort: { ...this.state.value.sort, [tab]: { column, direction } } });
  }

  clearError(): void {
    this.setState({ error: undefined });
  }

  cancelOrder(orderId: string): Promise<boolean> {
    return this.#run('cancel', orderId, () =>
      runAcknowledged(this.session, 'cancel', orderId, () => this.session.cancelOrder(orderId)),
    );
  }

  /** Asks the application to open the order in an order ticket (`amend` event). */
  requestAmend(orderId: string): void {
    const order = this.session.getOrder(orderId);
    if (order && isWorkingState(order.state)) this.emit('amend', order);
  }

  /** Asks the application to edit the position's take-profit and stop-loss (`edit-exits` event). */
  requestEditExits(positionId: string): void {
    const position = this.session.getPosition(positionId);
    if (position) this.emit('edit-exits', position);
  }

  /** Closes a position, or `quantity` of it. */
  closePosition(positionId: string, quantity?: number): Promise<boolean> {
    const position = this.session.getPosition(positionId);
    if (position && quantity !== undefined) {
      const problem = this.#closeProblem(position, quantity);
      if (problem) {
        this.setState({ error: problem });
        return Promise.resolve(false);
      }
    }
    const partial = position !== undefined && quantity !== undefined && quantity < position.quantity;
    return this.#run('close', positionId, () =>
      runAcknowledged(this.session, 'close', positionId, () =>
        this.session.closePosition(positionId, partial ? quantity : undefined),
      ),
    );
  }

  /** Starts entering a close for a position, with its full size as the quantity. */
  beginClose(positionId: string): void {
    const position = this.session.getPosition(positionId);
    if (!position) return;
    this.setState({ closing: { positionId, quantity: position.quantity, maximum: position.quantity } });
  }

  setCloseQuantity(quantity: number | undefined): void {
    const closing = this.state.value.closing;
    if (!closing) return;
    const position = this.session.getPosition(closing.positionId);
    const error = position ? this.#closeProblem(position, quantity) : undefined;
    this.setState({ closing: { ...closing, quantity, error } });
  }

  cancelClose(): void {
    if (this.state.value.closing) this.setState({ closing: undefined });
  }

  /** Sends the close being entered. */
  async confirmClose(): Promise<boolean> {
    const closing = this.state.value.closing;
    if (!closing) return false;
    const position = this.session.getPosition(closing.positionId);
    const error = position ? this.#closeProblem(position, closing.quantity) : 'The position is closed';
    if (error) {
      this.setState({ closing: { ...closing, error } });
      return false;
    }
    this.setState({ closing: undefined });
    return this.closePosition(closing.positionId, closing.quantity);
  }

  reversePosition(positionId: string): Promise<boolean> {
    return this.#run('reverse', positionId, () =>
      runAcknowledged(this.session, 'reverse', positionId, () => this.session.reversePosition(positionId)),
    );
  }

  setPositionExits(positionId: string, exits: ProtectiveExits): Promise<boolean> {
    return this.#run('set-exits', positionId, () =>
      runAcknowledged(this.session, 'set-exits', positionId, () => this.session.setPositionExits(positionId, exits)),
    );
  }

  #closeProblem(position: BrokerPosition, quantity: number | undefined): string | undefined {
    if (quantity === undefined) return 'Enter a quantity';
    const format = new InstrumentFormat(this.#resolver.peek(position.instrument));
    const step = format.instrument?.quantity.step;
    const rules = { min: step ?? 0, max: position.quantity, step: step ?? 1 };
    if (step === undefined) {
      if (!Number.isFinite(quantity)) return 'Enter a number';
      if (quantity <= 0) return 'Quantity must be positive';
      return quantity > position.quantity ? `At most ${format.quantity(position.quantity)}` : undefined;
    }
    const problem = checkQuantity(quantity, rules);
    return problem ? QUANTITY_PROBLEMS[problem](rules, format) : undefined;
  }

  async #run(action: PanelAction, targetId: string, work: () => Promise<void>): Promise<boolean> {
    if (this.#busy.has(targetId)) return false;
    this.#busy.add(targetId);
    this.#refresh({ error: undefined });
    try {
      await work();
      return true;
    } catch (error) {
      const message = describeTradingError(error);
      this.setState({ error: message });
      this.emit('action-error', { action, targetId, error, message });
      return false;
    } finally {
      this.#busy.delete(targetId);
      this.#refresh();
    }
  }

  #format(instrument: string): InstrumentFormat {
    const resolved = this.#resolver.peek(instrument);
    if (!resolved && !this.#failed.has(instrument)) {
      const pending = this.#resolver.get(instrument);
      if (!this.#waiting.has(pending)) {
        this.#waiting.add(pending);
        pending.then(
          () => {
            this.#waiting.delete(pending);
            this.#refresh();
          },
          () => {
            this.#waiting.delete(pending);
            this.#failed.add(instrument);
          },
        );
      }
    }
    return new InstrumentFormat(resolved);
  }

  #rows<T extends { id: string; instrument: string }>(
    tab: AccountTab,
    items: readonly T[],
    sort: SortOrder,
    context: CellContext,
  ): { row: PanelRow<T>; format: InstrumentFormat }[] {
    const defs = COLUMN_DEFS[tab] as unknown as readonly ColumnDef<T>[];
    const formats = new Map<string, InstrumentFormat>();
    const formatFor = (instrument: string) => {
      let format = formats.get(instrument);
      if (!format) {
        format = this.#format(instrument);
        formats.set(instrument, format);
      }
      return format;
    };
    const sortDef = defs.find((def) => def.id === sort.column);
    const sign = sort.direction === 'asc' ? 1 : -1;
    const entries = items.map((item, index) => ({ item, index, format: formatFor(item.instrument) }));
    if (sortDef) {
      entries.sort((a, b) => {
        const left = sortDef.sortValue(a.item, a.format);
        const right = sortDef.sortValue(b.item, b.format);
        if (left === undefined || right === undefined) return compareValues(left, right) || a.index - b.index;
        return sign * (compareValues(left, right) || a.index - b.index);
      });
    }
    return entries.map(({ item, format }) => {
      const cells: Record<string, string> = {};
      const tones: Record<string, CellTone | undefined> = {};
      for (const def of defs) {
        cells[def.id] = def.cell(item, format, context);
        const tone = def.tone?.(item);
        if (tone) tones[def.id] = tone;
      }
      return {
        row: { id: item.id, item, cells, tones, label: '', busy: this.#busy.has(item.id) },
        format,
      };
    });
  }

  #refresh(patch: Partial<AccountPanelState> = {}): void {
    if (this.disposed) return;
    const session = this.session;
    const state = { ...this.state.value, ...patch };
    const connection = session.connection.value;
    const connected = connection.state === 'connected';
    const caps = session.capabilities;
    const context: CellContext = { now: this.scheduler.now(), timeZone: this.timeZone };

    const allOrders = session.orders;
    const workingCount = allOrders.filter((order) => isWorkingState(order.state)).length;
    const visibleOrders = state.orderFilter === 'working' ? allOrders.filter((order) => isWorkingState(order.state)) : allOrders;
    const orderRows: OrderRow[] = this.#rows('orders', visibleOrders, state.sort.orders, context).map(({ row, format }) => {
      const order = row.item;
      const working = isWorkingState(order.state);
      return {
        ...row,
        label: describeOrder(order, format),
        working,
        canCancel: connected && working && !row.busy,
        canAmend: connected && working && caps.amendOrders && order.state !== 'pending' && !row.busy,
      };
    });
    const orders = groupExits(orderRows, allOrders);

    const canClose = caps.closePosition || caps.emulation;
    const canPartialClose = (caps.closePosition && caps.partialClose) || caps.emulation;
    const canReverse = caps.reversePosition || caps.emulation;
    const positions: PositionRow[] = this.#rows('positions', session.positions, state.sort.positions, context).map(
      ({ row, format }) => ({
        ...row,
        label: `${POSITION_SIDE_LABELS[row.item.side]} ${format.quantity(row.item.quantity)} ${format.name || row.item.instrument}`,
        canClose: connected && canClose && !row.busy,
        canPartialClose: connected && canPartialClose && !row.busy,
        canReverse: connected && canReverse && !row.busy,
        canEditExits: connected && caps.positionExits && !row.busy,
      }),
    );

    const allFills = session.fills;
    const newestFills =
      allFills.length > this.#fillLimit ? [...allFills].sort((a, b) => a.time - b.time).slice(-this.#fillLimit) : allFills;
    const fills: FillRow[] = this.#rows('fills', newestFills, state.sort.fills, context).map(({ row, format }) => ({
      ...row,
      label: `${SIDE_LABELS[row.item.side]} ${format.quantity(row.item.quantity)} ${format.name || row.item.instrument} at ${format.price(row.item.price)}`,
    }));

    let closing = state.closing;
    if (closing && !session.getPosition(closing.positionId)) closing = undefined;

    this.setState({
      ...patch,
      status: connected ? (this.#loaded ? 'ready' : 'loading') : connection.state === 'connecting' ? 'connecting' : 'disconnected',
      message: connected ? undefined : connection.message,
      summary: this.#summary(session.balance.value),
      orders,
      positions,
      fills,
      counts: { orders: workingCount, positions: positions.length, fills: fills.length },
      closing,
    });
  }

  #summary(balance: AccountBalance | undefined): AccountSummary | undefined {
    if (!balance) return undefined;
    const digits = moneyPrecision(balance.currency);
    const item = (id: SummaryItem['id'], label: string, value: number, signed = false): SummaryItem => ({
      id,
      label,
      value,
      text: formatAmount(value, digits, { signed }),
      tone: signed ? pnlTone(value) : undefined,
    });
    const items = [
      item('balance', 'Balance', balance.balance),
      item('equity', 'Equity', balance.equity),
      item('unrealized-pnl', 'Unrealized P&L', balance.unrealizedPnl, true),
      item('realized-pnl', 'Realized P&L', balance.realizedPnl, true),
    ];
    if (balance.marginUsed !== undefined) items.push(item('margin-used', 'Margin used', balance.marginUsed));
    if (balance.marginAvailable !== undefined) items.push(item('margin-available', 'Margin available', balance.marginAvailable));
    const account = this.session.accounts.find((candidate) => candidate.id === balance.accountId);
    return { accountId: balance.accountId, accountName: account?.name, currency: balance.currency, balance, items };
  }
}

/** Moves exits that wait for a listed entry order right after it, in the order they were created. */
function groupExits(rows: OrderRow[], created: readonly BrokerOrder[]): OrderRow[] {
  const listed = new Set(rows.map((row) => row.id));
  const children = new Map<string, OrderRow[]>();
  const top: OrderRow[] = [];
  for (const row of rows) {
    const parent = row.item.parent;
    if (parent?.kind === 'order' && listed.has(parent.id)) {
      const list = children.get(parent.id) ?? [];
      list.push({ ...row, parentId: parent.id });
      children.set(parent.id, list);
    } else {
      top.push(row);
    }
  }
  if (children.size === 0) return rows;
  const rank = new Map(created.map((order, index) => [order.id, index]));
  const byCreation = (a: OrderRow, b: OrderRow) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  return top.flatMap((row) => [row, ...(children.get(row.id)?.sort(byCreation) ?? [])]);
}

/** `Buy 10 ACME Limit 99.50`, `Sell 10 ACME Take-profit 101.00`. */
export function describeOrder(order: BrokerOrder, format: InstrumentFormat): string {
  const kind = order.exitRole ? EXIT_ROLE_LABELS[order.exitRole] : ORDER_KIND_LABELS[order.kind];
  const price = order.kind === 'market' ? '' : ` ${orderPriceText(order, format)}`;
  return `${SIDE_LABELS[order.side]} ${format.quantity(order.quantity)} ${format.name || order.instrument} ${kind}${price}`;
}
