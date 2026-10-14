// Scriptable connector for tests. Not exported from the package.
import type { BrokerConnector, BrokerUpdateSink } from './contract';
import type { BrokerCapabilities, BrokerOrder, BrokerPosition, OrderRequest } from './types';

export class ScriptedConnector implements BrokerConnector {
  sink: BrokerUpdateSink | undefined;
  orders: BrokerOrder[] = [];
  positions: BrokerPosition[] = [];
  capabilities: BrokerCapabilities = {};
  /** When true, actions succeed but no update is ever pushed. */
  silent = false;
  submitted: OrderRequest[] = [];
  resyncs = 0;
  #next = 0;

  async connect(sink: BrokerUpdateSink): Promise<void> {
    this.sink = sink;
  }

  async getCapabilities(): Promise<BrokerCapabilities> {
    return this.capabilities;
  }

  async getConnection() {
    return { state: 'connected' as const };
  }

  async listAccounts() {
    return [{ id: 'acc', name: 'Account', currency: 'USD' }];
  }

  async getActiveAccount() {
    return 'acc';
  }

  async listOrders() {
    this.resyncs++;
    return [...this.orders];
  }

  async listPositions() {
    return [...this.positions];
  }

  async listFills() {
    return [];
  }

  async getTradingRules(instrument: string) {
    return { instrument, tradable: true, tickSize: 0.01, quantity: { min: 1, step: 1 } };
  }

  async submitOrder(request: OrderRequest): Promise<string> {
    this.submitted.push(request);
    const id = `o${++this.#next}`;
    if (!this.silent) {
      const order: BrokerOrder = { ...request, id, state: 'open', filledQuantity: 0 };
      this.orders.push(order);
      queueUpdate(() => this.sink?.emit('order', order));
    }
    return id;
  }

  async amendOrder(): Promise<void> {}

  async cancelOrder(orderId: string): Promise<void> {
    if (this.silent) return;
    const order = this.orders.find((candidate) => candidate.id === orderId);
    if (order) queueUpdate(() => this.sink?.emit('order', { ...order, state: 'cancelled' }));
  }
}

function queueUpdate(update: () => void): void {
  void Promise.resolve().then(update);
}
