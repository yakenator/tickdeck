---
"@tickdeck/react": patch
"@tickdeck/vue": patch
---

`@tickdeck/react` and `@tickdeck/vue` export the element types (`TdkOrderTicketElement`, ...), the event detail types (`TdkAmendDetail`, ...), `TdkEventMap`, `TdkTheme`, `TdkToastPlacement` and `TicketInstrumentChoice`, so applications never import from `@tickdeck/elements`, which is only installed as their dependency (importing it failed under pnpm with TS2307 or ERR_MODULE_NOT_FOUND). The READMEs import from the wrapper.
