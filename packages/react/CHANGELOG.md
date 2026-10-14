# @tickdeck/react

## 0.1.0-alpha.1

### Patch Changes

- @tickdeck/elements@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- 579b6da: Remove `tdk-placeholder` and the `TdkPlaceholder` components.
- 579b6da: `tdk-order-ticket` gains `usePrice(price)` to fill its main price field from elsewhere, such as a chart click (also on the React ref), and keeps amend mode when its `instrument` is set to the amended order's instrument.
- c87ede6: Add the P1 trading widgets: headless AccountPanelController, OrderTicketController, TradeButtonsController and NotificationCenter in widgets-core; the tdk-account-panel, tdk-order-ticket, tdk-trade-buttons and tdk-notifications elements with --tdk-* theming, ::part() hooks and light, dark and auto presets; and React and Vue wrappers for all four.

### Patch Changes

- Updated dependencies [579b6da]
- Updated dependencies [579b6da]
- Updated dependencies [c87ede6]
  - @tickdeck/elements@0.1.0-alpha.0
