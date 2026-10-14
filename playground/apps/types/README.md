# TypeScript

A consumer that uses every framework-agnostic package, the React and Vue wrappers and a custom `BrokerConnector`, type-checked three times with `skipLibCheck: false`, so the published declarations are checked as well:

| Config | `module` / `moduleResolution` |
|---|---|
| [`tsconfig.bundler.json`](tsconfig.bundler.json) | `ESNext` / `Bundler` (Vite, webpack, esbuild) |
| [`tsconfig.nodenext.json`](tsconfig.nodenext.json) | `NodeNext` / `NodeNext` |
| [`tsconfig.node16.json`](tsconfig.node16.json) | `Node16` / `Node16` |

```sh
npm install @tickdeck/all@0.1.0-alpha.1 @tickdeck/react@0.1.0-alpha.1 @tickdeck/vue@0.1.0-alpha.1
npm install -D typescript @types/react
```

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": false
  }
}
```

The packages are ES modules only (`"type": "module"`, an `import` condition in `exports`), so under `node16` and `nodenext` the consuming files must be ES modules too: this package sets `"type": "module"`. The chart and elements declarations use DOM types, so include the `DOM` lib.

- [`src/consumer.ts`](src/consumer.ts): core, datafeed, broker (a custom connector implementing `BrokerConnector`), chart, widgets-core, elements (including the `HTMLElementTagNameMap` entries) and `@tickdeck/all`.
- [`src/react.tsx`](src/react.tsx): wrapper props, event callbacks and element refs.
- [`src/vue.ts`](src/vue.ts): wrapper props, emits and the exposed `element`.

```sh
npm run typecheck --workspace apps/types     # from playground/
```
