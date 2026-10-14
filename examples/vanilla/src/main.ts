// A full trading screen from tickdeck parts: chart with trading overlay, trade
// buttons, order ticket, account panel and notifications, all on one
// BrokerSession over MockBroker and MockFeed.
import '@tickdeck/elements/define';
import { AckTimeoutError, BrokerSession, MockBroker } from '@tickdeck/broker';
import { attachTrading, createChartView, type ChartStyle, type PriceScaleMode, type VolumeMode } from '@tickdeck/chart';
import { addExact, subtractExact } from '@tickdeck/core';
import { MockFeed } from '@tickdeck/datafeed';
import type {
  TdkAccountPanelElement,
  TdkNotificationsElement,
  TdkOrderTicketElement,
  TdkTradeButtonsElement,
} from '@tickdeck/elements';
import { describeTradingError } from '@tickdeck/widgets-core';
import { createExitsDialog } from './exits-dialog';
import './style.css';

type Theme = 'light' | 'dark';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const instrumentSelect = $<HTMLSelectElement>('instrument');
const timeframeSelect = $<HTMLSelectElement>('timeframe');
const styleSelect = $<HTMLSelectElement>('style');
const scaleSelect = $<HTMLSelectElement>('scale');
const volumeSelect = $<HTMLSelectElement>('volume');
const themeButton = $<HTMLButtonElement>('theme');
const marketForm = $<HTMLFormElement>('market');
const marketInput = $<HTMLInputElement>('market-price');
const marketHint = $('market-hint');
const chartContainer = $('chart');
const crosshairText = $('crosshair');
const buttons = $<TdkTradeButtonsElement>('buttons');
const ticket = $<TdkOrderTicketElement>('ticket');
const panel = $<TdkAccountPanelElement>('panel');
const notifications = $<TdkNotificationsElement>('notifications');
const widgets = [buttons, ticket, panel, notifications];

// ----- Data and trading --------------------------------------------------------

const feed = new MockFeed({ seed: 7 });
const session = new BrokerSession(new MockBroker({ feed, startingBalance: 100_000 }));
await session.start();

let instrument = 'MOCK:ACME';
let theme: Theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

for (const widget of widgets) {
  widget.session = session;
  widget.feed = feed;
  widget.theme = theme;
}
ticket.instrument = instrument;
buttons.instrument = instrument;

const view = createChartView(chartContainer, { feed, instrument, timeframe: '1m', theme });
const trading = attachTrading(view, session, { pnl: ['money', 'ticks'] });

const notify = (title: string, message?: string) =>
  notifications.activeController?.push({ level: 'error', title, message });

// Rejections and timeouts already reach the notifications through the session;
// anything else a chart gesture ran into is shown here.
trading.on('actionError', ({ error }) => {
  if (!(error instanceof AckTimeoutError)) notify('The change from the chart failed', describeTradingError(error));
});
view.on('error', ({ operation, error }) => notify(`Could not load ${operation === 'instrument' ? 'the instrument' : 'history'}`, String(error)));

// ----- Instrument, timeframe, style, scale, volume and theme -----------------------

for (const { id, name } of feed.instruments) instrumentSelect.add(new Option(name, id));
instrumentSelect.value = instrument;

/** Shows an instrument everywhere at once: chart, ticket and trade buttons. */
async function selectInstrument(id: string): Promise<void> {
  instrument = id;
  instrumentSelect.value = id;
  ticket.instrument = id;
  buttons.instrument = id;
  marketInput.value = '';
  await Promise.all([view.setInstrument(id).catch(() => {}), ticket.updateComplete, buttons.updateComplete]);
}

instrumentSelect.addEventListener('change', () => void selectInstrument(instrumentSelect.value));
timeframeSelect.addEventListener('change', () => view.setTimeframe(timeframeSelect.value));
styleSelect.addEventListener('change', () => view.setChartStyle(styleSelect.value as ChartStyle));
scaleSelect.addEventListener('change', () => view.setPriceScaleMode(scaleSelect.value as PriceScaleMode));
volumeSelect.addEventListener('change', () => view.setVolume(volumeSelect.value as VolumeMode));

function applyTheme(next: Theme): void {
  theme = next;
  document.documentElement.dataset.theme = next;
  for (const widget of widgets) widget.theme = next;
  // Reads the --tdk-* tokens of the new theme from the container again.
  view.setTheme(next);
  themeButton.setAttribute('aria-pressed', String(next === 'dark'));
  themeButton.textContent = next === 'dark' ? 'Light theme' : 'Dark theme';
}
applyTheme(theme);
themeButton.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));

// ----- Chart to ticket: Alt-click a price ----------------------------------------

view.crosshair.subscribe((point) => {
  crosshairText.textContent = point?.price === undefined ? '' : view.formatPrice(point.price);
});

let pressedAt: { x: number; y: number } | undefined;
chartContainer.addEventListener('pointerdown', (event) => (pressedAt = { x: event.clientX, y: event.clientY }), true);
chartContainer.addEventListener('click', (event) => {
  if (!event.altKey) return;
  // A drag (panning the chart, moving a line) ends with a click too.
  if (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > 4) return;
  const price = view.crosshair.value?.price;
  if (price !== undefined) useChartPrice(price);
});

/**
 * Puts a chart price into the ticket. A market ticket becomes a limit order
 * when the price is on the passive side of the market (below the ask for a
 * buy, above the bid for a sell) and a stop order otherwise.
 */
function useChartPrice(price: number): void {
  const controller = ticket.activeController;
  const state = controller?.state.value;
  if (!controller || !state || state.busy) return;
  if (state.kind === 'market') {
    const buy = state.side === 'buy';
    const market = buy ? state.quote?.ask : state.quote?.bid;
    const passive = market === undefined || (buy ? price < market : price > market);
    controller.setKind(passive ? 'limit' : 'stop');
  }
  ticket.usePrice(price);
}

// ----- Account panel to ticket and exits dialog --------------------------------------

// "Modify" on an order row: follow the order's instrument, then open it in the ticket.
panel.addEventListener('tdk-amend', async (event) => {
  const { order } = event.detail;
  await selectInstrument(order.instrument);
  await ticket.amend(order);
  ticket.scrollIntoView({ block: 'nearest' });
});

const exitsDialog = createExitsDialog({
  getInstrument: (id) => feed.getInstrument(id),
  async save(position, exits) {
    const controller = panel.activeController;
    if (!controller) return 'No trading session';
    // Through the panel's controller, so the row shows it as busy and failures land in the panel too.
    const done = await controller.setPositionExits(position.id, exits);
    return done ? undefined : (controller.state.value.error ?? 'The broker did not accept the change');
  },
});
// "TP/SL" on a position row.
panel.addEventListener('tdk-edit-exits', (event) => void exitsDialog.open(event.detail.position));

// ----- Simulated market ------------------------------------------------------------

view.on('bars', () => {
  const last = view.bars.at(-1)?.close;
  marketHint.textContent = last === undefined ? '' : `Last ${view.formatPrice(last)}`;
});

// Moves MockFeed's quote to a price (one tick each side); the random walk continues from there.
marketForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const info = view.instrumentInfo.value;
  const typed = Number(marketInput.value);
  if (!info || !(typed > 0)) return;
  const price = view.snapPrice(typed);
  void feed.setQuote(info.id, {
    bid: subtractExact(price, info.tickSize),
    ask: addExact(price, info.tickSize),
    last: price,
  });
});

// For poking around in the browser console.
Object.assign(window, { tickdeck: { feed, session, view, trading, ticket, buttons, panel, notifications, selectInstrument } });
