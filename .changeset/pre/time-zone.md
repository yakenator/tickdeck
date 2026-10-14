---
"@tickdeck/elements": patch
"@tickdeck/widgets-core": patch
"@tickdeck/react": patch
"@tickdeck/vue": patch
---

Elements accept a `time-zone` attribute (`timeZone` property) and a `scheduler` property for the controller they create; the React and Vue components accept `timeZone` and `scheduler` props. Changing the time zone updates the account panel's times, the notification log and the ticket's GTD expiry in place, without losing the widget's state. Widget controllers gain `setTimeZone()` and `timeZone`; `formatDateTimeInput`, `parseDateTimeInput` and `isValidTimeZone` are new helpers. The ticket's expiry field used the browser's time zone and the notification log the system clock before.
