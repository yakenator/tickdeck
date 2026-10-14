# @tickdeck/elements

tickdeck's trading widgets as standard Web Components (`tdk-*` custom elements built with Lit). They work in plain HTML and in any framework. Each element renders a headless controller from `@tickdeck/widgets-core` inside Shadow DOM.

> Alpha: APIs may still change between releases.

## Install

```sh
npm install @tickdeck/elements @tickdeck/broker @tickdeck/datafeed
```

## Usage

`@tickdeck/elements/define` registers every element (tags that are already defined are skipped). The main entry exports the classes without registering them.

```html
<tdk-order-ticket instrument="MOCK:ACME"></tdk-order-ticket>
<tdk-trade-buttons instrument="MOCK:ACME" quantity="1"></tdk-trade-buttons>
<tdk-account-panel></tdk-account-panel>
<tdk-notifications placement="bottom-end"></tdk-notifications>

<script type="module">
  import '@tickdeck/elements/define';
  import { BrokerSession, MockBroker } from '@tickdeck/broker';
  import { MockFeed } from '@tickdeck/datafeed';

  const feed = new MockFeed();
  const session = new BrokerSession(new MockBroker({ feed }));
  await session.start();

  for (const element of document.querySelectorAll('tdk-order-ticket, tdk-trade-buttons, tdk-account-panel, tdk-notifications')) {
    element.session = session;
    element.feed = feed;
  }

  // "Modify" in the panel opens the order in the ticket.
  const ticket = document.querySelector('tdk-order-ticket');
  document.querySelector('tdk-account-panel').addEventListener('tdk-amend', (event) => ticket.amend(event.detail.order));
</script>
```

### Common properties

| Property | Attribute | Description |
|---|---|---|
| `session` | | The `BrokerSession`. The element creates its own controller from it and disposes it when removed. |
| `feed` | | Quotes and instrument metadata, typically a `MarketFeed`. Needed for live prices and display names. |
| `controller` | | A controller you created yourself. Takes precedence over `session`; you keep ownership and dispose it. Its own context sets the time zone and clock (`timeZone` and `scheduler` apply to controllers the element creates). |
| `theme` | `theme` | `light` (default), `dark`, or `auto` (follows `prefers-color-scheme`). |
| `timeZone` | `time-zone` | IANA time zone of displayed times (panel times, notification log, ticket expiry), such as `America/New_York`. Default: the browser's. Changing it updates the times in place. An unknown zone falls back to the browser's with a console warning. |
| `scheduler` | | Clock and timers (a `Scheduler` from `@tickdeck/core`) for the controller the element creates. Default: the host's. |
| `activeController` | | Read-only: the controller being rendered. |

Rich values (session, feed, controller, arrays) are properties. Simple settings also work as attributes.

The elements can get a session before `session.start()` has finished: they show "Connecting to the broker…" until the session is connected, and the reason if connecting fails.

## Elements

### `<tdk-order-ticket>`

Instrument, live bid and ask (click one to use it as the price), side, order type, quantity with steppers, limit and stop prices, time in force and expiry, take-profit and stop-loss as a price or a distance in ticks, estimates, warnings, an optional review step and amend mode. Validation errors appear next to their fields.

| Property | Attribute | Description |
|---|---|---|
| `instrument` | `instrument` | Instrument id |
| `side` | `side` | `buy` (default) or `sell` |
| `kind` | `kind` | `market` (default), `limit`, `stop` or `stop-limit` |
| `quantity` | `quantity` | Default quantity; falls back to the instrument's minimum |
| `checkOrders` | `check-orders` | Check every order with the broker and ask for confirmation. Default: the broker's capability |
| `exitMode` | `exit-mode` | How exits are entered at first: `price` or `ticks` |
| `instruments` | | Instruments for a picker: ids, or `{ id, name }` objects |

Methods: `amend(order)`, `usePrice(price)` (fills the limit price, or the stop price of a stop or stop-limit order, for example from a chart click), `submit()`, `reset()`.

Setting `instrument` to the instrument the ticket already shows, for example right before or after `amend(order)` for an order on another instrument, keeps amend mode.

Keyboard: Tab through the fields; arrow keys move within the side, order type and exit entry groups; ArrowUp and ArrowDown in a quantity or price field step by one quantity step or one tick; Enter submits.

### `<tdk-account-panel>`

Account summary, and tabs for orders (working or all), positions and fills. Columns sort when their header is clicked. Order rows offer Modify and Cancel; position rows offer TP/SL (when the broker supports exits on positions), Reverse and Close. Close opens a quantity field for a full or partial close: Enter confirms, Escape cancels.

| Property | Attribute | Description |
|---|---|---|
| `tab` | `tab` | Initial tab: `orders`, `positions` or `fills` |
| `orderFilter` | `order-filter` | Initial order filter: `working` or `all` |

Keyboard: arrow keys, Home and End move between tabs.

### `<tdk-trade-buttons>`

Sell (at the bid) and buy (at the ask) buttons with the spread between them, and a quantity field. A disabled side says why (connecting, not connected, not tradable, invalid quantity, no price). Each button is named by its visible text ("Sell 111.22") and described by the order it sends ("Sell 10 ACME at market").

| Property | Attribute | Description |
|---|---|---|
| `instrument` | `instrument` | Instrument id |
| `quantity` | `quantity` | Default quantity |
| `confirm` | `confirm` | Ask for confirmation before each order. Escape cancels a pending confirmation |

### `<tdk-notifications>`

Toasts for fills, rejections, broker notices, acknowledgement timeouts, ignored updates and connection changes, with a log of everything shown. New messages are announced through live regions (errors assertively). Toasts pause while hovered or focused; Escape or the × button dismisses one.

| Property | Attribute | Description |
|---|---|---|
| `placement` | `placement` | `inline` (default) or fixed to a corner: `top-start`, `top-end`, `bottom-start`, `bottom-end` |
| `hideLog` | `hide-log` | Hide the log button and list |
| `maxToasts` | `max-toasts` | Most toasts on screen at once |

## Events

Events are `CustomEvent`s that bubble and are `composed`, so they cross shadow roots and can be handled on `document`. `TdkEventMap` lists them with their detail types, and `HTMLElementEventMap` and `DocumentEventMap` know them.

| Event | Element | Detail | Notes |
|---|---|---|---|
| `tdk-order-placed` | order ticket, trade buttons | `{ orderId, request }` | After the broker confirmed the order |
| `tdk-order-amended` | order ticket | `{ orderId, changes }` | |
| `tdk-order-error` | order ticket, trade buttons | `{ action, message, error }` | `action`: `check`, `submit`, `amend` or `trade` |
| `tdk-cancel-order` | account panel | `{ order }` | Cancelable: `preventDefault()` stops the cancellation |
| `tdk-close-position` | account panel | `{ position, quantity? }` | Cancelable. `quantity` is set for a partial close |
| `tdk-reverse-position` | account panel | `{ position }` | Cancelable |
| `tdk-amend` | account panel | `{ order }` | Open the order in a ticket (`ticket.amend(order)`) |
| `tdk-edit-exits` | account panel | `{ position }` | Edit the position's take-profit and stop-loss |
| `tdk-action-error` | account panel | `{ action, targetId, message, error }` | A cancel, close, reverse or exit change failed |
| `tdk-tab-change` | account panel | `{ tab }` | |
| `tdk-notification` | notifications | `{ notification }` | |
| `tdk-dismiss` | notifications | `{ notification }` | |

## Theming

Every themable value is a CSS custom property. Custom properties inherit into shadow roots, so set them on `:root` or on any container. Values you set always win over the light and dark presets.

```css
:root {
  --tdk-color-buy: #1565c0;
  --tdk-color-buy-text: #1565c0;
  --tdk-radius: 2px;
  --tdk-font-family: 'Inter', sans-serif;
}

tdk-order-ticket::part(submit-button) {
  text-transform: uppercase;
}
```

Colours are flat; the default themes use no gradients.

| Property | Light default | Dark default | Used for |
|---|---|---|---|
| `--tdk-color-surface` | `#ffffff` | `#15191e` | Backgrounds |
| `--tdk-color-surface-2` | `#f3f5f7` | `#1f252c` | Raised areas, neutral buttons |
| `--tdk-color-text` | `#1b1f24` | `#e6e9ed` | Text |
| `--tdk-color-text-muted` | `#5b6470` | `#9aa4af` | Labels, secondary text |
| `--tdk-color-border` | `#d4d8de` | `#343c46` | Borders, table rules |
| `--tdk-color-accent` | `#2f6fdf` | `#5b94f0` | Selected options, primary buttons |
| `--tdk-color-on-accent` | `#ffffff` | `#0b1220` | Text on accent |
| `--tdk-color-buy` | `#1a7f5a` | `#1a7f5a` | Buy buttons and selected side |
| `--tdk-color-on-buy` | `#ffffff` | `#ffffff` | Text on buy |
| `--tdk-color-buy-text` | `#1a7f5a` | `#3fc28d` | Buy and long as text |
| `--tdk-color-sell` | `#c4314b` | `#c4314b` | Sell buttons and selected side |
| `--tdk-color-on-sell` | `#ffffff` | `#ffffff` | Text on sell |
| `--tdk-color-sell-text` | `#c4314b` | `#f2687e` | Sell and short as text |
| `--tdk-color-positive` | `#1a7f5a` | `#3fc28d` | Gains |
| `--tdk-color-negative` | `#c4314b` | `#f2687e` | Losses |
| `--tdk-color-info` | `#2f6fdf` | `#6aa2f5` | Info toasts and results |
| `--tdk-color-success` | `#1a7f5a` | `#3fc28d` | Success toasts and results |
| `--tdk-color-warning` | `#9a5b00` | `#e3a63c` | Warnings |
| `--tdk-color-error` | `#c4314b` | `#f2687e` | Errors, invalid fields |
| `--tdk-color-focus` | `#2f6fdf` | `#6aa2f5` | Focus rings |
| `--tdk-font-family` | system UI stack | | All text |
| `--tdk-font-size-1` | `12px` | | Labels, small text |
| `--tdk-font-size-2` | `13px` | | Body text |
| `--tdk-font-size-3` | `16px` | | Prices, headings |
| `--tdk-space-1`, `-2`, `-3` | `4px`, `8px`, `12px` | | Spacing |
| `--tdk-radius` | `4px` | | Corner radius |
| `--tdk-control-height` | `30px` | | Buttons and fields |
| `--tdk-z-index-toasts` | `1000` | | Fixed toast stack |
| `--tdk-notifications-log-height` | `240px` | | Log list height |

### Parts

Style internals from outside with `::part()`.

| Element | Parts |
|---|---|
| `tdk-order-ticket` | `form`, `header`, `instrument`, `instrument-select`, `mode`, `status`, `quote`, `bid`, `ask`, `spread`, `side`, `kind`, `field`, `quantity-field`, `limit-field`, `stop-field`, `tif-field`, `expiry-field`, `input`, `quantity-input`, `limit-price-input`, `stop-price-input`, `take-profit-input`, `stop-loss-input`, `expiry-input`, `select`, `tif-select`, `step-button`, `error`, `exits`, `exit`, `take-profit`, `stop-loss`, `checkbox`, `exit-mode`, `hint`, `estimates`, `warnings`, `review`, `review-estimates`, `review-warnings`, `confirm-button`, `back-button`, `submit-button`, `cancel-amend-button`, `result` |
| `tdk-account-panel` | `panel`, `summary`, `summary-account`, `summary-item`, `status`, `error`, `tabs`, `tab`, `tab-selected`, `count`, `filter`, `tabpanel`, `table`, `header-row`, `sort-button`, `row`, `actions`, `action-button`, `amend-button`, `cancel-button`, `exits-button`, `reverse-button`, `close-button`, `close-row`, `input`, `confirm-close-button`, `cancel-close-button`, `empty` |
| `tdk-trade-buttons` | `container`, `instrument`, `mode`, `sell-button`, `buy-button`, `spread`, `confirm`, `confirm-button`, `cancel-button`, `quantity`, `step-button`, `input`, `quantity-input`, `reason`, `result` |
| `tdk-notifications` | `live-region`, `toasts`, `toast`, `toast-info`, `toast-success`, `toast-warning`, `toast-error`, `toast-title`, `toast-message`, `dismiss-button`, `log-toggle`, `log-clear`, `log`, `log-item` |

## Building your own

`TdkWidgetElement` is the base class: it handles `controller`, `session`, `feed` and `theme`, owns created controllers and re-renders on state changes. `themeStyles` and `baseStyles` hold the token mapping and shared control styles.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
