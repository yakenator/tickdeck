---
"@tickdeck/broker": patch
"@tickdeck/widgets-core": patch
"@tickdeck/elements": patch
---

`BrokerSession.start()` reports `connection.state === 'connecting'` as soon as it is called, then the connector's state. A failed start reports `error` with the reason, rejects, and can be retried (a connector that did connect is disconnected again). Widgets rendered before the session has connected show "Connecting to the broker…" instead of "Not connected to the broker": `WidgetAvailability` and the account panel's `PanelStatus` gain `connecting`, and the notification center announces "Could not connect to the broker" when a start fails.
