import type * as Elements from '@tickdeck/elements';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as wrapper from './index';
import type {
  TdkAccountPanelElement,
  TdkActionErrorDetail,
  TdkAmendDetail,
  TdkEditExitsDetail,
  TdkEventMap,
  TdkNotificationsElement,
  TdkOrderPlacedDetail,
  TdkOrderTicketElement,
  TdkTheme,
  TdkToastPlacement,
  TdkTradeButtonsElement,
  TicketInstrumentChoice,
} from './index';

describe('@tickdeck/vue exports', () => {
  it('re-exports the element and event types, so applications never import @tickdeck/elements', () => {
    expectTypeOf<TdkOrderTicketElement>().toEqualTypeOf<Elements.TdkOrderTicketElement>();
    expectTypeOf<TdkAccountPanelElement>().toEqualTypeOf<Elements.TdkAccountPanelElement>();
    expectTypeOf<TdkTradeButtonsElement>().toEqualTypeOf<Elements.TdkTradeButtonsElement>();
    expectTypeOf<TdkNotificationsElement>().toEqualTypeOf<Elements.TdkNotificationsElement>();
    expectTypeOf<TdkAmendDetail>().toEqualTypeOf<Elements.TdkAmendDetail>();
    expectTypeOf<TdkEditExitsDetail>().toEqualTypeOf<Elements.TdkEditExitsDetail>();
    expectTypeOf<TdkOrderPlacedDetail>().toEqualTypeOf<Elements.TdkOrderPlacedDetail>();
    expectTypeOf<TdkActionErrorDetail>().toEqualTypeOf<Elements.TdkActionErrorDetail>();
    expectTypeOf<TdkEventMap>().toEqualTypeOf<Elements.TdkEventMap>();
    expectTypeOf<TdkTheme>().toEqualTypeOf<Elements.TdkTheme>();
    expectTypeOf<TdkToastPlacement>().toEqualTypeOf<Elements.TdkToastPlacement>();
    expectTypeOf<TicketInstrumentChoice>().toEqualTypeOf<Elements.TicketInstrumentChoice>();
  });

  it('exports a component per element', () => {
    expect(Object.keys(wrapper).sort()).toEqual(['TdkAccountPanel', 'TdkNotifications', 'TdkOrderTicket', 'TdkTradeButtons', 'VERSION']);
  });
});
