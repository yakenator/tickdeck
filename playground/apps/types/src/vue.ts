// Type-checks the Vue wrappers: props, emits and the exposed element.
import type { BrokerSession } from '@tickdeck/broker';
import type { MarketFeed } from '@tickdeck/datafeed';
import type { TdkAmendDetail } from '@tickdeck/elements';
import { TdkAccountPanel, TdkOrderTicket } from '@tickdeck/vue';
import { defineComponent, h, ref } from 'vue';

export function createTrading(session: BrokerSession, feed: MarketFeed) {
  return defineComponent({
    setup() {
      const ticket = ref<InstanceType<typeof TdkOrderTicket>>();
      const amend = ({ order }: TdkAmendDetail) => void ticket.value?.element?.amend(order);
      return () => [
        h(TdkOrderTicket, { ref: ticket, session, feed, instrument: 'MOCK:ACME', kind: 'limit' }),
        h(TdkAccountPanel, { session, feed, onAmend: amend }),
      ];
    },
  });
}
