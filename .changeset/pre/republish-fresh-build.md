---
"@tickdeck/core": patch
---

Republish all packages from a fresh build. 0.1.0-alpha.0 shipped stale build output (for example, `@tickdeck/core` imported `decimal.js`, which is no longer a dependency) and is deprecated.
