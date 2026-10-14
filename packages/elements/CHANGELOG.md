# @tickdeck/elements

## 0.1.0-alpha.2

### Patch Changes

- b82b8b3: Accessibility (WCAG 2.5.3 Label in Name, 4.1.2): the order ticket's Bid and Ask buttons read "Bid 111.22" on screen as in their names; the trade buttons are named by their visible text ("Sell 111.22") and describe the order and any reason they are disabled through `aria-describedby`; the spread between them is plain text instead of an `aria-label` on a `<div>`; the account panel's TP/SL button starts its name with "TP/SL". The chart's root no longer has `tabindex="1"`: it is focusable in document order (`tabindex="0"`), exposed as an image named after its instrument and timeframe ("ACME, 1m chart") and outlined on keyboard focus. Chart shortcuts (Shift+arrows, Shift+plus and minus) no longer swallow keys typed into fields inside Web Components such as the order ticket.
- b82b8b3: `BrokerSession.start()` reports `connection.state === 'connecting'` as soon as it is called, then the connector's state. A failed start reports `error` with the reason, rejects, and can be retried (a connector that did connect is disconnected again). Widgets rendered before the session has connected show "Connecting to the broker…" instead of "Not connected to the broker": `WidgetAvailability` and the account panel's `PanelStatus` gain `connecting`, and the notification center announces "Could not connect to the broker" when a start fails.
- b82b8b3: Elements fill the space their layout gives them: the host is a flex column (`display: flex`) whose visible box grows to the host's height, so a ticket stretched next to a chart ends at the chart's bottom; without an imposed height an element keeps its natural height, and a short account panel scrolls its table. A chart whose container is sized by a grid or flex row now shrinks again when the row does (its canvases no longer hold the container at its previous height). The READMEs and examples show one equal-height pattern for a chart and a column of widgets.
- b82b8b3: Elements accept a `time-zone` attribute (`timeZone` property) and a `scheduler` property for the controller they create; the React and Vue components accept `timeZone` and `scheduler` props. Changing the time zone updates the account panel's times, the notification log and the ticket's GTD expiry in place, without losing the widget's state. Widget controllers gain `setTimeZone()` and `timeZone`; `formatDateTimeInput`, `parseDateTimeInput` and `isValidTimeZone` are new helpers. The ticket's expiry field used the browser's time zone and the notification log the system clock before.
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
  - @tickdeck/widgets-core@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- @tickdeck/widgets-core@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- 579b6da: Remove `tdk-placeholder` and the `TdkPlaceholder` components.
- 579b6da: `tdk-order-ticket` gains `usePrice(price)` to fill its main price field from elsewhere, such as a chart click (also on the React ref), and keeps amend mode when its `instrument` is set to the amended order's instrument.
- c87ede6: Add the P1 trading widgets: headless AccountPanelController, OrderTicketController, TradeButtonsController and NotificationCenter in widgets-core; the tdk-account-panel, tdk-order-ticket, tdk-trade-buttons and tdk-notifications elements with --tdk-* theming, ::part() hooks and light, dark and auto presets; and React and Vue wrappers for all four.

### Patch Changes

- Updated dependencies [c87ede6]
  - @tickdeck/widgets-core@0.1.0-alpha.0
