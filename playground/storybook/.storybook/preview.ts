import type { Preview } from '@storybook/web-components-vite';
import '@tickdeck/elements/define';
import '../src/chart-host';
import '../src/tokens.css';
import { disposeOwner } from '../src/scenario';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme of the widgets, the chart and the canvas',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (story, { globals }) => {
      // The page tokens follow the theme; renders pass the same theme to the widgets.
      document.documentElement.dataset.theme = globals.theme === 'dark' ? 'dark' : 'light';
      return story();
    },
  ],
  // Each story's mock feed and session are disposed when it unmounts or re-renders.
  beforeEach: ({ id }) => () => disposeOwner(id),
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    a11y: {
      // Accessibility violations fail the story's test. Nothing is excluded: the issues found in 0.1.0-alpha.1
      // (label-in-name, the spread's aria-label, the chart's tabindex) are fixed in 0.1.0-alpha.2.
      test: 'error',
    },
  },
  tags: ['autodocs'],
};

export default preview;
