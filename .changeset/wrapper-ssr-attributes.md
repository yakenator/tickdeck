---
"@tickdeck/react": patch
"@tickdeck/vue": patch
---

Server-side rendering of the React and Vue components keeps simple props: strings, numbers and booleans such as `instrument`, `kind`, `quantity`, `checkOrders`, `theme` and `timeZone` are rendered as the element's attributes (`check-orders`, `time-zone`, ...), with `true` as an empty attribute and `false` left out, so the server HTML reads `<tdk-order-ticket instrument="MOCK:ACME" kind="limit">`. Rich props (`session`, `feed`, `controller`, arrays) are still set as properties after hydration. Vue components pass `class`, `id`, `style` and listeners first.
