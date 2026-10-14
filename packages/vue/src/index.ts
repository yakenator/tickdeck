import '@tickdeck/elements/define';
import { defineComponent, h } from 'vue';
import { version } from '../package.json';

export const VERSION: string = version;

export const TdkPlaceholder = defineComponent({
  name: 'TdkPlaceholder',
  props: { label: String },
  setup(props, { slots }) {
    return () => h('tdk-placeholder', { label: props.label }, slots.default?.());
  },
});
