# @tickdeck/widgets-core

## 0.1.0-alpha.2

### Patch Changes

- b82b8b3: `BrokerSession.start()` reports `connection.state === 'connecting'` as soon as it is called, then the connector's state. A failed start reports `error` with the reason, rejects, and can be retried (a connector that did connect is disconnected again). Widgets rendered before the session has connected show "Connecting to the broker…" instead of "Not connected to the broker": `WidgetAvailability` and the account panel's `PanelStatus` gain `connecting`, and the notification center announces "Could not connect to the broker" when a start fails.
- b82b8b3: Elements accept a `time-zone` attribute (`timeZone` property) and a `scheduler` property for the controller they create; the React and Vue components accept `timeZone` and `scheduler` props. Changing the time zone updates the account panel's times, the notification log and the ticket's GTD expiry in place, without losing the widget's state. Widget controllers gain `setTimeZone()` and `timeZone`; `formatDateTimeInput`, `parseDateTimeInput` and `isValidTimeZone` are new helpers. The ticket's expiry field used the browser's time zone and the notification log the system clock before.
- Updated dependencies [b82b8b3]
  - @tickdeck/broker@0.1.0-alpha.2
  - @tickdeck/core@0.1.0-alpha.2
  - @tickdeck/datafeed@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies
  - @tickdeck/core@0.1.0-alpha.1
  - @tickdeck/broker@0.1.0-alpha.1
  - @tickdeck/datafeed@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- c87ede6: Add the P1 trading widgets: headless AccountPanelController, OrderTicketController, TradeButtonsController and NotificationCenter in widgets-core; the tdk-account-panel, tdk-order-ticket, tdk-trade-buttons and tdk-notifications elements with --tdk-* theming, ::part() hooks and light, dark and auto presets; and React and Vue wrappers for all four.

### Patch Changes

- Updated dependencies [579b6da]
- Updated dependencies [8b73334]
  - @tickdeck/core@0.1.0-alpha.0
  - @tickdeck/datafeed@0.1.0-alpha.0
  - @tickdeck/broker@0.1.0-alpha.0
