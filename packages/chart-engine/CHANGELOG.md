# @tickdeck/chart-engine

## 0.1.0-alpha.0

### Minor Changes

- 579b6da: The canvas rendering engine behind `@tickdeck/chart`, derived from KLineChart 10.0.4 (Apache-2.0), with a clean-room input handler and tickdeck names. Applications should use `@tickdeck/chart`.
- fadc6eb: The engine and the chart can be imported without a DOM (server-side rendering); they need one only once a chart is created.
