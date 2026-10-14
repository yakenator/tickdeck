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
import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  version as reactVersion,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type PropsWithoutRef,
  type RefAttributes,
} from 'react';
import { version } from '../package.json';

export const VERSION: string = version;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
// React 18 passes `className` to custom elements as an attribute named `className`.
const LEGACY_CLASS_NAME = Number.parseInt(reactVersion, 10) < 19;

type Handler<D> = (event: CustomEvent<D>) => void;

/** Props every wrapper accepts besides the usual HTML attributes. */
export interface TdkWidgetProps<E extends { controller?: unknown; session?: unknown; feed?: unknown }> extends HTMLAttributes<HTMLElement> {
  /** A widgets-core controller to render. Takes precedence over `session`. */
  controller?: E['controller'];
  /** The trading session. The element creates its own controller from it. */
  session?: E['session'];
  /** Quotes and instrument metadata, typically a `MarketFeed`. */
  feed?: E['feed'];
  theme?: TdkTheme;
}

interface WrapperSpec {
  tag: string;
  displayName: string;
  /** Props set as element properties. */
  properties: readonly string[];
  /** Callback prop name to DOM event type. */
  events: Readonly<Record<string, string>>;
}

const COMMON_PROPERTIES = ['controller', 'session', 'feed', 'theme'] as const;

/**
 * Builds a component that renders a `tdk-*` element, assigns rich props as
 * element properties and subscribes callback props to its events through a
 * ref. Works the same on React 18 (which would stringify objects into
 * attributes) and React 19.
 */
function createWrapper<E extends HTMLElement, P extends object>(
  spec: WrapperSpec,
): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<E>> {
  const properties = new Set<string>([...COMMON_PROPERTIES, ...spec.properties]);
  const Component = forwardRef<E, P>((props, forwardedRef) => {
    const ref = useRef<E | null>(null);
    const assigned = useRef(new Set<string>());
    const handlers = useRef<Record<string, unknown>>({});
    useImperativeHandle(forwardedRef, () => ref.current as E, []);

    const values: Record<string, unknown> = {};
    const callbacks: Record<string, unknown> = {};
    const passthrough: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(props)) {
      if (properties.has(name)) values[name] = value;
      else if (name in spec.events) callbacks[name] = value;
      else if (name === 'className' && LEGACY_CLASS_NAME) passthrough.class = value;
      else passthrough[name] = value;
    }
    handlers.current = callbacks;

    useIsomorphicLayoutEffect(() => {
      const element = ref.current as unknown as Record<string, unknown> | null;
      if (!element) return;
      for (const name of properties) {
        if (!(name in values) && !assigned.current.has(name)) continue;
        if (element[name] !== values[name]) element[name] = values[name];
        assigned.current.add(name);
      }
    });

    useIsomorphicLayoutEffect(() => {
      const element = ref.current;
      if (!element) return;
      const removers = Object.entries(spec.events).map(([prop, type]) => {
        const listener = (event: Event) => (handlers.current[prop] as ((event: Event) => void) | undefined)?.(event);
        element.addEventListener(type, listener);
        return () => element.removeEventListener(type, listener);
      });
      return () => {
        for (const remove of removers) remove();
      };
    }, []);

    return createElement(spec.tag, { ...passthrough, ref });
  });
  Component.displayName = spec.displayName;
  return Component;
}

export interface TdkAccountPanelProps extends TdkWidgetProps<TdkAccountPanelElement> {
  tab?: TdkAccountPanelElement['tab'];
  orderFilter?: TdkAccountPanelElement['orderFilter'];
  /** Cancelable: call `preventDefault()` to stop the cancellation. */
  onCancelOrder?: Handler<TdkCancelOrderDetail>;
  onAmend?: Handler<TdkAmendDetail>;
  /** Cancelable. */
  onClosePosition?: Handler<TdkClosePositionDetail>;
  /** Cancelable. */
  onReversePosition?: Handler<TdkReversePositionDetail>;
  onEditExits?: Handler<TdkEditExitsDetail>;
  onActionError?: Handler<TdkActionErrorDetail>;
  onTabChange?: Handler<TdkTabChangeDetail>;
}

/** Orders, positions and fills with an account summary (`<tdk-account-panel>`). */
export const TdkAccountPanel = createWrapper<TdkAccountPanelElement, TdkAccountPanelProps>({
  tag: 'tdk-account-panel',
  displayName: 'TdkAccountPanel',
  properties: ['tab', 'orderFilter'],
  events: {
    onCancelOrder: 'tdk-cancel-order',
    onAmend: 'tdk-amend',
    onClosePosition: 'tdk-close-position',
    onReversePosition: 'tdk-reverse-position',
    onEditExits: 'tdk-edit-exits',
    onActionError: 'tdk-action-error',
    onTabChange: 'tdk-tab-change',
  },
});

export interface TdkOrderTicketProps extends TdkWidgetProps<TdkOrderTicketElement> {
  instrument?: string;
  side?: TdkOrderTicketElement['side'];
  kind?: TdkOrderTicketElement['kind'];
  quantity?: number;
  checkOrders?: boolean;
  exitMode?: TdkOrderTicketElement['exitMode'];
  instruments?: TdkOrderTicketElement['instruments'];
  onOrderPlaced?: Handler<TdkOrderPlacedDetail>;
  onOrderAmended?: Handler<TdkOrderAmendedDetail>;
  onOrderError?: Handler<TdkOrderErrorDetail>;
}

/** Order entry (`<tdk-order-ticket>`). The ref's `amend(order)` edits a working order and `usePrice(price)` fills the price field. */
export const TdkOrderTicket = createWrapper<TdkOrderTicketElement, TdkOrderTicketProps>({
  tag: 'tdk-order-ticket',
  displayName: 'TdkOrderTicket',
  properties: ['instrument', 'side', 'kind', 'quantity', 'checkOrders', 'exitMode', 'instruments'],
  events: {
    onOrderPlaced: 'tdk-order-placed',
    onOrderAmended: 'tdk-order-amended',
    onOrderError: 'tdk-order-error',
  },
});

export interface TdkTradeButtonsProps extends TdkWidgetProps<TdkTradeButtonsElement> {
  instrument?: string;
  quantity?: number;
  confirm?: boolean;
  onOrderPlaced?: Handler<TdkOrderPlacedDetail>;
  onOrderError?: Handler<TdkOrderErrorDetail>;
}

/** Buy and sell at market with live bid and ask (`<tdk-trade-buttons>`). */
export const TdkTradeButtons = createWrapper<TdkTradeButtonsElement, TdkTradeButtonsProps>({
  tag: 'tdk-trade-buttons',
  displayName: 'TdkTradeButtons',
  properties: ['instrument', 'quantity', 'confirm'],
  events: {
    onOrderPlaced: 'tdk-order-placed',
    onOrderError: 'tdk-order-error',
  },
});

export interface TdkNotificationsProps extends TdkWidgetProps<TdkNotificationsElement> {
  placement?: TdkNotificationsElement['placement'];
  hideLog?: boolean;
  maxToasts?: number;
  onNotification?: Handler<TdkNotificationDetail>;
  onDismiss?: Handler<TdkDismissDetail>;
}

/** Toasts and a notification log (`<tdk-notifications>`). */
export const TdkNotifications = createWrapper<TdkNotificationsElement, TdkNotificationsProps>({
  tag: 'tdk-notifications',
  displayName: 'TdkNotifications',
  properties: ['placement', 'hideLog', 'maxToasts'],
  events: {
    onNotification: 'tdk-notification',
    onDismiss: 'tdk-dismiss',
  },
});
