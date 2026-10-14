// Type-checks the React wrappers: props, event callbacks and element refs.
import type { BrokerSession } from '@tickdeck/broker';
import type { MarketFeed } from '@tickdeck/datafeed';
// The element types come from the wrapper, which re-exports them (0.1.0-alpha.2), not from @tickdeck/elements.
import {
  TdkAccountPanel,
  TdkNotifications,
  TdkOrderTicket,
  TdkTradeButtons,
  type TdkAccountPanelElement,
  type TdkAmendDetail,
  type TdkOrderTicketElement,
} from '@tickdeck/react';
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
        timeZone="Asia/Seoul"
        onAmend={(event: CustomEvent<TdkAmendDetail>) => void ticket.current?.amend(event.detail.order)}
        onEditExits={(event) => void panel.current?.activeController?.setPositionExits(event.detail.position.id, { takeProfit: null })}
      />
      <TdkNotifications session={session} feed={feed} placement="bottom-end" />
    </>
  );
}
