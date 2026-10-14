import '@tickdeck/elements/define';
import type {
  TdkAccountPanelElement,
  TdkActionErrorDetail,
  TdkAmendDetail,
  TdkCancelOrderDetail,
  TdkClosePositionDetail,
  TdkDismissDetail,
  TdkEditExitsDetail,
  TdkNotificationDetail,
  TdkNotificationsElement,
  TdkOrderAmendedDetail,
  TdkOrderErrorDetail,
  TdkOrderPlacedDetail,
  TdkOrderTicketElement,
  TdkReversePositionDetail,
  TdkTabChangeDetail,
  TdkTheme,
  TdkTradeButtonsElement,
} from '@tickdeck/elements';
import { defineComponent, h, ref, toRaw, type PropType } from 'vue';
import { version } from '../package.json';

export const VERSION: string = version;

// Element and event types, so applications type refs and handlers without importing `@tickdeck/elements` themselves.
export type {
  TdkAccountPanelElement,
  TdkActionErrorDetail,
  TdkAmendDetail,
  TdkCancelOrderDetail,
  TdkClosePositionDetail,
  TdkDismissDetail,
  TdkEditExitsDetail,
  TdkEventMap,
  TdkNotificationDetail,
  TdkNotificationsElement,
  TdkOrderAmendedDetail,
  TdkOrderErrorDetail,
  TdkOrderPlacedDetail,
  TdkOrderTicketElement,
  TdkReversePositionDetail,
  TdkTabChangeDetail,
  TdkTheme,
  TdkToastPlacement,
  TdkTradeButtonsElement,
  TicketInstrumentChoice,
} from '@tickdeck/elements';

/**
 * A wrapper's type with the exposed `element` (the custom element, once
 * mounted) on its instance, so `ref<InstanceType<typeof TdkOrderTicket>>()`
 * sees `element`.
 */
type WithElement<C, E extends HTMLElement> = C &
  (new (...args: any[]) => (C extends new (...args: any[]) => infer I ? I : never) & { readonly element: E | undefined });

/** Unwraps Vue proxies: controllers and sessions keep private fields that proxies cannot reach. */
const raw = <T>(value: T): T => (value !== null && typeof value === 'object' ? toRaw(value) : value);

/** Element properties, set with Vue's `.prop` binding so objects are never turned into attributes. */
function properties(source: Record<string, unknown>): Record<string, unknown> {
  const bound: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) bound[`.${name}`] = raw(value);
  return bound;
}

/**
 * Simple values also as attributes (Vue's `^attr` binding), keyed by attribute
 * name, so server-side rendering produces meaningful HTML. `true` is an empty
 * attribute, `false` and `undefined` none.
 */
function attributes(source: Record<string, unknown>): Record<string, unknown> {
  const bound: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string' || typeof value === 'number') bound[`^${name}`] = value;
    else if (value === true) bound[`^${name}`] = '';
  }
  return bound;
}

const objectProp = <T>() => ({ type: Object as PropType<T>, default: undefined });
const optionalBoolean = { type: Boolean, default: undefined };

const commonProps = <E extends { controller?: unknown; session?: unknown; feed?: unknown; scheduler?: unknown }>() => ({
  /** A widgets-core controller to render. Takes precedence over `session`. Pass it raw (`markRaw` or `shallowRef`). */
  controller: objectProp<E['controller']>(),
  /** The trading session. Pass it raw (`markRaw` or `shallowRef`). */
  session: objectProp<E['session']>(),
  /** Quotes and instrument metadata, typically a `MarketFeed`. */
  feed: objectProp<E['feed']>(),
  /** Clock and timers for the controller the element creates. */
  scheduler: objectProp<E['scheduler']>(),
  /** IANA time zone of displayed times, such as `America/New_York`. Default: the browser's. */
  timeZone: String,
  theme: String as PropType<TdkTheme>,
});

/** Common props as attributes and properties. */
const common = (props: { controller?: unknown; session?: unknown; feed?: unknown; scheduler?: unknown; timeZone?: string; theme?: string }) => ({
  ...attributes({ theme: props.theme, 'time-zone': props.timeZone }),
  ...properties({
    controller: props.controller,
    session: props.session,
    feed: props.feed,
    scheduler: props.scheduler,
    timeZone: props.timeZone,
    theme: props.theme,
  }),
});

const TdkAccountPanelComponent = defineComponent({
  name: 'TdkAccountPanel',
  // Attributes such as `class` and `id` are passed on first, ahead of the element's own attributes.
  inheritAttrs: false,
  props: {
    ...commonProps<TdkAccountPanelElement>(),
    tab: String as PropType<NonNullable<TdkAccountPanelElement['tab']>>,
    orderFilter: String as PropType<NonNullable<TdkAccountPanelElement['orderFilter']>>,
  },
  emits: {
    /** Cancelable on the element; call `preventDefault()` on the second argument to stop it. */
    'cancel-order': (_detail: TdkCancelOrderDetail, _event: CustomEvent) => true,
    amend: (_detail: TdkAmendDetail) => true,
    'close-position': (_detail: TdkClosePositionDetail, _event: CustomEvent) => true,
    'reverse-position': (_detail: TdkReversePositionDetail, _event: CustomEvent) => true,
    'edit-exits': (_detail: TdkEditExitsDetail) => true,
    'action-error': (_detail: TdkActionErrorDetail) => true,
    'tab-change': (_detail: TdkTabChangeDetail) => true,
  },
  setup(props, { attrs, emit, expose, slots }) {
    const element = ref<TdkAccountPanelElement>();
    expose({ element });
    return () =>
      h(
        'tdk-account-panel',
        {
          ...attrs,
          ref: element,
          ...common(props),
          ...attributes({ tab: props.tab, 'order-filter': props.orderFilter }),
          ...properties({ tab: props.tab, orderFilter: props.orderFilter }),
          onTdkCancelOrder: (event: CustomEvent<TdkCancelOrderDetail>) => emit('cancel-order', event.detail, event),
          onTdkAmend: (event: CustomEvent<TdkAmendDetail>) => emit('amend', event.detail),
          onTdkClosePosition: (event: CustomEvent<TdkClosePositionDetail>) => emit('close-position', event.detail, event),
          onTdkReversePosition: (event: CustomEvent<TdkReversePositionDetail>) =>
            emit('reverse-position', event.detail, event),
          onTdkEditExits: (event: CustomEvent<TdkEditExitsDetail>) => emit('edit-exits', event.detail),
          onTdkActionError: (event: CustomEvent<TdkActionErrorDetail>) => emit('action-error', event.detail),
          onTdkTabChange: (event: CustomEvent<TdkTabChangeDetail>) => emit('tab-change', event.detail),
        },
        slots.default?.(),
      );
  },
});

/** Orders, positions and fills with an account summary (`<tdk-account-panel>`). Events carry the detail. */
export const TdkAccountPanel = TdkAccountPanelComponent as WithElement<typeof TdkAccountPanelComponent, TdkAccountPanelElement>;

const TdkOrderTicketComponent = defineComponent({
  name: 'TdkOrderTicket',
  // Attributes such as `class` and `id` are passed on first, ahead of the element's own attributes.
  inheritAttrs: false,
  props: {
    ...commonProps<TdkOrderTicketElement>(),
    instrument: String,
    side: String as PropType<NonNullable<TdkOrderTicketElement['side']>>,
    kind: String as PropType<NonNullable<TdkOrderTicketElement['kind']>>,
    quantity: Number,
    checkOrders: optionalBoolean,
    exitMode: String as PropType<NonNullable<TdkOrderTicketElement['exitMode']>>,
    instruments: Array as PropType<NonNullable<TdkOrderTicketElement['instruments']>>,
  },
  emits: {
    'order-placed': (_detail: TdkOrderPlacedDetail) => true,
    'order-amended': (_detail: TdkOrderAmendedDetail) => true,
    'order-error': (_detail: TdkOrderErrorDetail) => true,
  },
  setup(props, { attrs, emit, expose, slots }) {
    const element = ref<TdkOrderTicketElement>();
    expose({ element });
    return () =>
      h(
        'tdk-order-ticket',
        {
          ...attrs,
          ref: element,
          ...common(props),
          ...attributes({
            instrument: props.instrument,
            side: props.side,
            kind: props.kind,
            quantity: props.quantity,
            'check-orders': props.checkOrders,
            'exit-mode': props.exitMode,
          }),
          ...properties({
            instrument: props.instrument,
            side: props.side,
            kind: props.kind,
            quantity: props.quantity,
            checkOrders: props.checkOrders,
            exitMode: props.exitMode,
            instruments: props.instruments,
          }),
          onTdkOrderPlaced: (event: CustomEvent<TdkOrderPlacedDetail>) => emit('order-placed', event.detail),
          onTdkOrderAmended: (event: CustomEvent<TdkOrderAmendedDetail>) => emit('order-amended', event.detail),
          onTdkOrderError: (event: CustomEvent<TdkOrderErrorDetail>) => emit('order-error', event.detail),
        },
        slots.default?.(),
      );
  },
});

/** Order entry (`<tdk-order-ticket>`). The exposed `element` has `amend(order)` and `usePrice(price)`. */
export const TdkOrderTicket = TdkOrderTicketComponent as WithElement<typeof TdkOrderTicketComponent, TdkOrderTicketElement>;

const TdkTradeButtonsComponent = defineComponent({
  name: 'TdkTradeButtons',
  // Attributes such as `class` and `id` are passed on first, ahead of the element's own attributes.
  inheritAttrs: false,
  props: {
    ...commonProps<TdkTradeButtonsElement>(),
    instrument: String,
    quantity: Number,
    confirm: optionalBoolean,
  },
  emits: {
    'order-placed': (_detail: TdkOrderPlacedDetail) => true,
    'order-error': (_detail: TdkOrderErrorDetail) => true,
  },
  setup(props, { attrs, emit, expose, slots }) {
    const element = ref<TdkTradeButtonsElement>();
    expose({ element });
    return () =>
      h(
        'tdk-trade-buttons',
        {
          ...attrs,
          ref: element,
          ...common(props),
          ...attributes({ instrument: props.instrument, quantity: props.quantity, confirm: props.confirm }),
          ...properties({ instrument: props.instrument, quantity: props.quantity, confirm: props.confirm }),
          onTdkOrderPlaced: (event: CustomEvent<TdkOrderPlacedDetail>) => emit('order-placed', event.detail),
          onTdkOrderError: (event: CustomEvent<TdkOrderErrorDetail>) => emit('order-error', event.detail),
        },
        slots.default?.(),
      );
  },
});

/** Buy and sell at market with live bid and ask (`<tdk-trade-buttons>`). */
export const TdkTradeButtons = TdkTradeButtonsComponent as WithElement<typeof TdkTradeButtonsComponent, TdkTradeButtonsElement>;

const TdkNotificationsComponent = defineComponent({
  name: 'TdkNotifications',
  // Attributes such as `class` and `id` are passed on first, ahead of the element's own attributes.
  inheritAttrs: false,
  props: {
    ...commonProps<TdkNotificationsElement>(),
    placement: String as PropType<NonNullable<TdkNotificationsElement['placement']>>,
    hideLog: optionalBoolean,
    maxToasts: Number,
  },
  emits: {
    notification: (_detail: TdkNotificationDetail) => true,
    dismiss: (_detail: TdkDismissDetail) => true,
  },
  setup(props, { attrs, emit, expose, slots }) {
    const element = ref<TdkNotificationsElement>();
    expose({ element });
    return () =>
      h(
        'tdk-notifications',
        {
          ...attrs,
          ref: element,
          ...common(props),
          ...attributes({ placement: props.placement, 'hide-log': props.hideLog, 'max-toasts': props.maxToasts }),
          ...properties({ placement: props.placement, hideLog: props.hideLog, maxToasts: props.maxToasts }),
          onTdkNotification: (event: CustomEvent<TdkNotificationDetail>) => emit('notification', event.detail),
          onTdkDismiss: (event: CustomEvent<TdkDismissDetail>) => emit('dismiss', event.detail),
        },
        slots.default?.(),
      );
  },
});

/** Toasts and a notification log (`<tdk-notifications>`). */
export const TdkNotifications = TdkNotificationsComponent as WithElement<typeof TdkNotificationsComponent, TdkNotificationsElement>;
