# @tickdeck/broker

## 0.1.0-alpha.2

### Patch Changes

- b82b8b3: `BrokerSession.start()` reports `connection.state === 'connecting'` as soon as it is called, then the connector's state. A failed start reports `error` with the reason, rejects, and can be retried (a connector that did connect is disconnected again). Widgets rendered before the session has connected show "Connecting to the broker…" instead of "Not connected to the broker": `WidgetAvailability` and the account panel's `PanelStatus` gain `connecting`, and the notification center announces "Could not connect to the broker" when a start fails.
- @tickdeck/core@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies
  - @tickdeck/core@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- 8b73334: Add the trading contracts: shared trading types and decimal-safe math in core; the MarketFeed contract with MockFeed and HttpPollingFeed in datafeed; the BrokerConnector contract, order lifecycle checks, acknowledgement deadlines, BrokerSession and MockBroker in broker.

### Patch Changes

- Updated dependencies [579b6da]
- Updated dependencies [8b73334]
  - @tickdeck/core@0.1.0-alpha.0
