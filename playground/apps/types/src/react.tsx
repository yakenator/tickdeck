// Type-checks the React wrappers: props, event callbacks and element refs.
import type { BrokerSession } from '@tickdeck/broker';
import type { MarketFeed } from '@tickdeck/datafeed';
import type { TdkAccountPanelElement, TdkOrderTicketElement } from '@tickdeck/elements';
import { TdkAccountPanel, TdkNotifications, TdkOrderTicket, TdkTradeButtons } from '@tickdeck/react';
import { useRef, type ReactElement } from 'react';

export function Trading({ session, feed }: { session: BrokerSession; feed: MarketFeed }): ReactElement {
  const ticket = useRef<TdkOrderTicketElement>(null);
  const panel = useRef<TdkAccountPanelElement>(null);
  return (
    <>
      <TdkTradeButtons session={session} feed={feed} instrument="MOCK:ACME" quantity={10} theme="dark" />
      <TdkOrderTicket ref={ticket} session={session} feed={feed} instrument="MOCK:ACME" kind="limit" className="ticket" />
      <TdkAccountPanel
        ref={panel}
        session={session}
        feed={feed}
        onAmend={(event) => void ticket.current?.amend(event.detail.order)}
        onEditExits={(event) => void panel.current?.activeController?.setPositionExits(event.detail.position.id, { takeProfit: null })}
      />
      <TdkNotifications session={session} feed={feed} placement="bottom-end" />
    </>
  );
}
