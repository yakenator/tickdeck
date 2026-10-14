// Type-checks the Vue wrappers: props, emits and the exposed element.
import type { BrokerSession } from '@tickdeck/broker';
import type { MarketFeed } from '@tickdeck/datafeed';
// The detail types come from the wrapper, which re-exports them (0.1.0-alpha.2), not from @tickdeck/elements.
import { TdkAccountPanel, TdkOrderTicket, type TdkAmendDetail, type TdkOrderTicketElement } from '@tickdeck/vue';
import { defineComponent, h, ref } from 'vue';

export function createTrading(session: BrokerSession, feed: MarketFeed) {
  return defineComponent({
    setup() {
      const ticket = ref<InstanceType<typeof TdkOrderTicket>>();
      const amend = ({ order }: TdkAmendDetail) => {
        const element: TdkOrderTicketElement | undefined = ticket.value?.element;
        void element?.amend(order);
      };
      return () => [
        h(TdkOrderTicket, { ref: ticket, session, feed, instrument: 'MOCK:ACME', kind: 'limit' }),
        h(TdkAccountPanel, { session, feed, timeZone: 'Asia/Seoul', onAmend: amend }),
      ];
    },
  });
}
