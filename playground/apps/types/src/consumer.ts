// A TypeScript consumer of every framework-agnostic package. It is only
// type-checked (with bundler, nodenext and node16 resolution), never run.
import {
  BrokerSession,
  MockBroker,
  type BrokerCapabilities,
  type BrokerConnector,
  type BrokerOrder,
  type BrokerPosition,
  type BrokerUpdateSink,
  type OrderRequest,
  type TradingRules,
} from '@tickdeck/broker';
import { attachTrading, createChartView, type ChartView, type TradingLine, type TradingOverlay } from '@tickdeck/chart';
import { ObservableValue, addExact, formatDecimal, roundToTick, type Instrument, type Quote, type Side } from '@tickdeck/core';
import { HttpPollingFeed, MockFeed, parseTimeframe, type MarketFeed } from '@tickdeck/datafeed';
import { TdkOrderTicketElement, type TdkAmendDetail, type TdkTheme } from '@tickdeck/elements';
import { OrderTicketController, describeTradingError, type WidgetContext } from '@tickdeck/widgets-core';
import * as all from '@tickdeck/all';

// ----- core ------------------------------------------------------------------
const side: Side = 'buy';
const price: number = roundToTick(addExact(99.995, 0.01), 0.01);
const text: string = formatDecimal(price, 2);
const counter = new ObservableValue(0);
const unsubscribe: () => void = counter.subscribe((value: number) => void value);
unsubscribe();

// ----- datafeed --------------------------------------------------------------
const mock = new MockFeed({ seed: 1, autoTick: false });
const feed: MarketFeed = mock;
const http: MarketFeed = new HttpPollingFeed({ baseUrl: 'https://example.com/api/feed' });
const minutes = parseTimeframe('5m');
async function lastPrice(instrument: string): Promise<number | undefined> {
  const [quote]: Quote[] = await feed.loadQuotes([instrument]);
  const info: Instrument = await http.getInstrument(instrument);
  return quote?.last === undefined ? undefined : roundToTick(quote.last, info.tickSize);
}

// ----- broker: a custom connector type-checks against the contract ----------
class PaperConnector implements BrokerConnector {
  #sink?: BrokerUpdateSink;
  #orders: BrokerOrder[] = [];

  async connect(sink: BrokerUpdateSink): Promise<void> {
    this.#sink = sink;
    sink.emit('connection', { state: 'connected' });
  }
  async getCapabilities(): Promise<BrokerCapabilities> {
    return { orderKinds: ['market', 'limit'], orderExits: true };
  }
  async getConnection() {
    return { state: 'connected' as const };
  }
  async listAccounts() {
    return [{ id: 'paper', name: 'Paper', currency: 'USD', kind: 'demo' as const }];
  }
  async getActiveAccount(): Promise<string> {
    return 'paper';
  }
  async listOrders(): Promise<BrokerOrder[]> {
    return this.#orders;
  }
  async listPositions(): Promise<BrokerPosition[]> {
    return [];
  }
  async listFills() {
    return [];
  }
  async getTradingRules(instrument: string): Promise<TradingRules> {
    return { instrument, tradable: true, tickSize: 0.01, quantity: { min: 1, step: 1 } };
  }
  async submitOrder(request: OrderRequest): Promise<string> {
    const order = { ...request, id: `paper-${this.#orders.length + 1}`, state: 'open', filledQuantity: 0 } satisfies BrokerOrder;
    this.#orders.push(order);
    this.#sink?.emit('order', order);
    return order.id;
  }
  async amendOrder(): Promise<void> {}
  async cancelOrder(): Promise<void> {}
}

const paper = new BrokerSession(new PaperConnector(), { ackTimeoutMs: 5_000 });
const simulated = new BrokerSession(new MockBroker({ feed: mock, startingBalance: 50_000 }));
simulated.on('fill', (fill) => void fill.price);
simulated.on('timeout', (error) => void error.action);
async function bracket(): Promise<string> {
  await simulated.start();
  return simulated.submitOrder({ instrument: 'MOCK:ACME', side, kind: 'limit', quantity: 1, limitPrice: 99.5, takeProfit: 101, stopLoss: 99 });
}

// ----- chart -----------------------------------------------------------------
function mountChart(container: HTMLElement): { view: ChartView; trading: TradingOverlay } {
  const view = createChartView(container, { feed, instrument: 'MOCK:ACME', timeframe: '1m', theme: 'dark', style: 'area' });
  const trading = attachTrading(view, simulated, { pnl: ['money', 'ticks'] });
  const lines: readonly TradingLine[] = trading.scene.value.lines;
  void lines;
  view.crosshair.subscribe((point) => void point?.price);
  return { view, trading };
}

// ----- widgets-core and elements ----------------------------------------------
const context: WidgetContext = { session: simulated, feed };
const controller = new OrderTicketController(context, { instrument: 'MOCK:ACME' });
controller.state.subscribe((state) => void state.kind);
const message: string = describeTradingError(new Error('rejected'));

function wireTicket(): void {
  // The tag name map is augmented: querySelector returns the element class.
  const ticket: TdkOrderTicketElement | null = document.querySelector('tdk-order-ticket');
  const panel = document.querySelector('tdk-account-panel');
  if (!ticket || !panel) return;
  ticket.session = simulated;
  ticket.feed = feed;
  ticket.theme = 'dark' satisfies TdkTheme;
  ticket.usePrice(101.25);
  panel.addEventListener('tdk-amend', (event: CustomEvent<TdkAmendDetail>) => void ticket.amend(event.detail.order));
}

// ----- all: the same API from one package --------------------------------------
const fromAll: typeof BrokerSession = all.BrokerSession;
const version: string = all.VERSION;

export { bracket, fromAll, lastPrice, message, minutes, mountChart, paper, text, version, wireTicket };
