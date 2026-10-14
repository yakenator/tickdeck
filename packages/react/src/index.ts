import '@tickdeck/elements/define';
import { createElement, type HTMLAttributes, type ReactElement } from 'react';
import { version } from '../package.json';

export const VERSION: string = version;

export interface TdkPlaceholderProps extends HTMLAttributes<HTMLElement> {
  label?: string;
}

export function TdkPlaceholder(props: TdkPlaceholderProps): ReactElement {
  return createElement('tdk-placeholder', props);
}
