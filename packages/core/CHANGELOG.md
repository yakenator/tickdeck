# @tickdeck/core

## 0.1.0-alpha.0

### Minor Changes

- 579b6da: The exact decimal helpers compute on `BigInt`, so core has no runtime dependencies (decimal.js is gone). Results are unchanged, except that negative zero is no longer returned.
- 8b73334: Add the trading contracts: shared trading types and decimal-safe math in core; the MarketFeed contract with MockFeed and HttpPollingFeed in datafeed; the BrokerConnector contract, order lifecycle checks, acknowledgement deadlines, BrokerSession and MockBroker in broker.
