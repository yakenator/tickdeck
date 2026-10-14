# @tickdeck/vue

## 0.1.0-alpha.0

### Minor Changes

- 579b6da: Remove `tdk-placeholder` and the `TdkPlaceholder` components.
- c87ede6: Add the P1 trading widgets: headless AccountPanelController, OrderTicketController, TradeButtonsController and NotificationCenter in widgets-core; the tdk-account-panel, tdk-order-ticket, tdk-trade-buttons and tdk-notifications elements with --tdk-* theming, ::part() hooks and light, dark and auto presets; and React and Vue wrappers for all four.
- 579b6da: The components type their exposed `element`, so `ref<InstanceType<typeof TdkOrderTicket>>().value?.element?.amend(order)` type-checks.

### Patch Changes

- Updated dependencies [579b6da]
- Updated dependencies [579b6da]
- Updated dependencies [c87ede6]
  - @tickdeck/elements@0.1.0-alpha.0
