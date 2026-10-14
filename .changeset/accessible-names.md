---
"@tickdeck/elements": patch
"@tickdeck/chart": patch
"@tickdeck/chart-engine": patch
---

Accessibility (WCAG 2.5.3 Label in Name, 4.1.2): the order ticket's Bid and Ask buttons read "Bid 111.22" on screen as in their names; the trade buttons are named by their visible text ("Sell 111.22") and describe the order and any reason they are disabled through `aria-describedby`; the spread between them is plain text instead of an `aria-label` on a `<div>`; the account panel's TP/SL button starts its name with "TP/SL". The chart's root no longer has `tabindex="1"`: it is focusable in document order (`tabindex="0"`), exposed as an image named after its instrument and timeframe ("ACME, 1m chart") and outlined on keyboard focus. Chart shortcuts (Shift+arrows, Shift+plus and minus) no longer swallow keys typed into fields inside Web Components such as the order ticket.
