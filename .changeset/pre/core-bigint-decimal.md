---
"@tickdeck/core": minor
---

The exact decimal helpers compute on `BigInt`, so core has no runtime dependencies (decimal.js is gone). Results are unchanged, except that negative zero is no longer returned.
