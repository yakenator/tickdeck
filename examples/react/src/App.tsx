import { BrokerSession, MockBroker, type BrokerPosition } from '@tickdeck/broker';
import { MockFeed } from '@tickdeck/datafeed';
import {
  TdkAccountPanel,
  TdkNotifications,
  TdkOrderTicket,
  TdkTradeButtons,
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

export function App() {
  const [ready, setReady] = useState(false);
  const [instrument, setInstrument] = useState('MOCK:ACME');
  const [theme, setTheme] = useState<Theme>('light');
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
        <select aria-label="Instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)}>
          {feed.instruments.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button className="button" type="button" aria-pressed={theme === 'dark'} onClick={toggleTheme}>
          Dark theme
        </button>
        <span className="hint">Alt-click the chart to use a price in the ticket.</span>
      </header>
      <main className="layout">
        <TradingChart
          feed={feed}
          session={session}
          instrument={instrument}
          theme={theme}
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
      <input aria-label="Take-profit" placeholder="Take-profit" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} />
      <input aria-label="Stop-loss" placeholder="Stop-loss" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} />
      <button className="button" type="submit">
        Save
      </button>
      <button className="button" type="button" onClick={onClose}>
        Cancel
      </button>
      {failed && <span className="error">Not accepted; see the account panel.</span>}
    </form>
  );
}
