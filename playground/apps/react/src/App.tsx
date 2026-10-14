import { BrokerSession, MockBroker, type BrokerPosition } from '@tickdeck/broker';
import type { ChartView, TradingOverlay, VolumeMode } from '@tickdeck/chart';
import { addExact, roundToTick, subtractExact } from '@tickdeck/core';
import { MockFeed } from '@tickdeck/datafeed';
// The element types come from the wrapper (re-exported since 0.1.0-alpha.2); @tickdeck/elements is only its dependency.
import {
  TdkAccountPanel,
  TdkNotifications,
  TdkOrderTicket,
  TdkTradeButtons,
  VERSION,
  type TdkAccountPanelElement,
  type TdkOrderTicketElement,
} from '@tickdeck/react';
import { useEffect, useRef, useState } from 'react';
import { TradingChart } from './TradingChart';

// One feed and one session for the whole app, created outside React.
const feed = new MockFeed({ seed: 7 });
const session = new BrokerSession(new MockBroker({ feed }));
const started = session.start();

type Theme = 'light' | 'dark';

declare global {
  interface Window {
    /** For the browser console and the end-to-end tests. */
    playground?: { feed: MockFeed; session: BrokerSession; view?: ChartView; trading?: TradingOverlay };
  }
}
window.playground = { feed, session };

export function App() {
  const [ready, setReady] = useState(false);
  const [instrument, setInstrument] = useState('MOCK:ACME');
  const [theme, setTheme] = useState<Theme>('light');
  const [volume, setVolume] = useState<VolumeMode>('pane');
  const [editing, setEditing] = useState<BrokerPosition>();
  const ticket = useRef<TdkOrderTicketElement>(null);
  const panel = useRef<TdkAccountPanelElement>(null);

  useEffect(() => void started.then(() => setReady(true)), []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    // Switch the page's tokens first, so the chart reads the new ones.
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  if (!ready) return <p className="hint">Connecting to the mock broker…</p>;

  const common = { session, feed, theme };
  return (
    <>
      <header className="toolbar">
        <strong>tickdeck + React</strong>
        <span className="hint">
          version <span id="version">{VERSION}</span> · <a href="../">All playground apps</a>
        </span>
        <select id="instrument" aria-label="Instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)}>
          {feed.instruments.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select id="volume" aria-label="Volume" value={volume} onChange={(event) => setVolume(event.target.value as VolumeMode)}>
          <option value="pane">Volume: pane</option>
          <option value="overlay">Volume: overlay</option>
          <option value="none">Volume: none</option>
        </select>
        <button className="button" type="button" aria-pressed={theme === 'dark'} onClick={toggleTheme}>
          Dark theme
        </button>
        <MarketControl instrument={instrument} />
      </header>
      <main className="layout">
        <TradingChart
          feed={feed}
          session={session}
          instrument={instrument}
          theme={theme}
          volume={volume}
          onCreated={(view, trading) => Object.assign(window.playground!, { view, trading })}
          onPickPrice={(price) => ticket.current?.usePrice(price)}
        />
        <aside className="side">
          <TdkTradeButtons {...common} instrument={instrument} quantity={10} />
          <TdkOrderTicket {...common} ref={ticket} instrument={instrument} kind="limit" quantity={10} />
          {editing && (
            <ExitsEditor
              key={editing.id}
              position={editing}
              onSave={(exits) => panel.current?.activeController?.setPositionExits(editing.id, exits) ?? Promise.resolve(false)}
              onClose={() => setEditing(undefined)}
            />
          )}
        </aside>
        <TdkAccountPanel
          {...common}
          ref={panel}
          className="panel"
          onAmend={(event) => {
            // Follow the order's instrument, then open the order in the ticket.
            setInstrument(event.detail.order.instrument);
            void ticket.current?.amend(event.detail.order);
          }}
          onEditExits={(event) => setEditing(event.detail.position)}
        />
      </main>
      <TdkNotifications {...common} placement="bottom-end" />
    </>
  );
}

/** Moves the mock market to a typed price (one tick each side); the random walk continues from there. */
function MarketControl({ instrument }: { instrument: string }) {
  const [price, setPrice] = useState('');
  return (
    <form
      id="market"
      className="market"
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        const typed = Number(price);
        if (!(typed > 0)) return;
        const { tickSize } = await feed.getInstrument(instrument);
        const last = roundToTick(typed, tickSize);
        await feed.setQuote(instrument, { bid: subtractExact(last, tickSize), ask: addExact(last, tickSize), last });
      }}
    >
      <label className="hint" htmlFor="market-price">
        Simulated market
      </label>
      <input id="market-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
      <button className="button" type="submit">
        Move
      </button>
    </form>
  );
}

interface ExitsEditorProps {
  position: BrokerPosition;
  onSave: (exits: { takeProfit: number | null; stopLoss: number | null }) => Promise<boolean>;
  onClose: () => void;
}

/** A small take-profit and stop-loss form for a position. An empty field removes that exit. */
function ExitsEditor({ position, onSave, onClose }: ExitsEditorProps) {
  const [takeProfit, setTakeProfit] = useState(position.takeProfit?.toString() ?? '');
  const [stopLoss, setStopLoss] = useState(position.stopLoss?.toString() ?? '');
  const [failed, setFailed] = useState(false);
  const price = (text: string) => (text.trim() === '' ? null : Number(text));

  return (
    <form
      id="exits-form"
      className="exits"
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await onSave({ takeProfit: price(takeProfit), stopLoss: price(stopLoss) });
        if (saved) onClose();
        else setFailed(true);
      }}
    >
      <strong>
        TP/SL for {position.side === 'buy' ? 'long' : 'short'} {position.quantity} {position.instrument}
      </strong>
      <input id="exits-take-profit" aria-label="Take-profit" placeholder="Take-profit" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} />
      <input id="exits-stop-loss" aria-label="Stop-loss" placeholder="Stop-loss" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} />
      <button id="exits-save" className="button" type="submit">
        Save
      </button>
      <button className="button" type="button" onClick={onClose}>
        Cancel
      </button>
      {failed && <span className="error">Not accepted; see the account panel.</span>}
    </form>
  );
}
