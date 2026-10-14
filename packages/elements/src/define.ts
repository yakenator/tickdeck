import { TdkPlaceholderElement } from './placeholder';

const elements: Record<string, CustomElementConstructor> = {
  'tdk-placeholder': TdkPlaceholderElement,
};

for (const [tag, element] of Object.entries(elements)) {
  if (!customElements.get(tag)) customElements.define(tag, element);
}
