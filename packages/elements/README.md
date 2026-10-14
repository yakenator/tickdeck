# @tickdeck/elements

tickdeck widgets as standard Web Components. Works in plain HTML and in any framework.

> Pre-alpha and under construction. APIs will change without notice.

## Install

```sh
npm install @tickdeck/elements
```

## Usage

```js
import '@tickdeck/elements/define';
```

```html
<tdk-placeholder label="Hello"></tdk-placeholder>
```

The main entry exports the element classes without registering them; `@tickdeck/elements/define` registers every `tdk-*` element.

Part of [tickdeck](https://github.com/yakenator/tickdeck). Licensed under Apache-2.0.
