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
      // Accessibility violations fail the story's test.
      test: 'error',
      config: {
        // Known issues in the published 0.1.0-alpha.1 components (reported; see the storybook README).
        // Each exclusion covers only the affected nodes, so the rules still run everywhere else.
        // All three are fixed in the next release (0.1.0-alpha.2): remove them when the playground moves to it.
        // The chart then names its own root ("ACME, 1m chart", role img, tabindex 0), so <playground-chart> can drop
        // its role and aria-label too.
        rules: [
          {
            // WCAG 2.5.3 Label in Name: the visible text is not part of the accessible name.
            // Ticket Bid/Ask ("Bid 111.22" vs "Bid111.22"), trade buttons ("Sell 10 ACME at market, bid 111.22"
            // vs "Sell111.22") and the panel's "TP/SL" ("Edit take-profit and stop-loss: Long 10 ACME").
            // Fixed in 0.1.0-alpha.2.
            id: 'label-content-name-mismatch',
            selector:
              '*:not([part~="bid"]):not([part~="ask"]):not([part~="sell-button"]):not([part~="buy-button"]):not([part~="exits-button"])',
          },
          {
            // WCAG 4.1.2: tdk-trade-buttons puts aria-label on the spread's <div> (no role) and hides its text,
            // so the spread is not exposed at all.
            // Fixed in 0.1.0-alpha.2.
            id: 'aria-prohibited-attr',
            selector: '*:not([part~="spread"])',
          },
          {
            // @tickdeck/chart: the engine's root <div> has tabindex="1".
            // Fixed in 0.1.0-alpha.2.
            id: 'tabindex',
            selector: '[tabindex]:not([data-chart-engine-root])',
          },
        ],
      },
    },
  },
  tags: ['autodocs'],
};

export default preview;
