# @tickdeck/vue

## 0.1.0-alpha.2

### Patch Changes

- b82b8b3: Elements accept a `time-zone` attribute (`timeZone` property) and a `scheduler` property for the controller they create; the React and Vue components accept `timeZone` and `scheduler` props. Changing the time zone updates the account panel's times, the notification log and the ticket's GTD expiry in place, without losing the widget's state. Widget controllers gain `setTimeZone()` and `timeZone`; `formatDateTimeInput`, `parseDateTimeInput` and `isValidTimeZone` are new helpers. The ticket's expiry field used the browser's time zone and the notification log the system clock before.
- b82b8b3: Server-side rendering of the React and Vue components keeps simple props: strings, numbers and booleans such as `instrument`, `kind`, `quantity`, `checkOrders`, `theme` and `timeZone` are rendered as the element's attributes (`check-orders`, `time-zone`, ...), with `true` as an empty attribute and `false` left out, so the server HTML reads `<tdk-order-ticket instrument="MOCK:ACME" kind="limit">`. Rich props (`session`, `feed`, `controller`, arrays) are still set as properties after hydration. Vue components pass `class`, `id`, `style` and listeners first.
- b82b8b3: `@tickdeck/react` and `@tickdeck/vue` export the element types (`TdkOrderTicketElement`, ...), the event detail types (`TdkAmendDetail`, ...), `TdkEventMap`, `TdkTheme`, `TdkToastPlacement` and `TicketInstrumentChoice`, so applications never import from `@tickdeck/elements`, which is only installed as their dependency (importing it failed under pnpm with TS2307 or ERR_MODULE_NOT_FOUND). The READMEs import from the wrapper.
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
- Updated dependencies [b82b8b3]
  - @tickdeck/elements@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- @tickdeck/elements@0.1.0-alpha.1

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
