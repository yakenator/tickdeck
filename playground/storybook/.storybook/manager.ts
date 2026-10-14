import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle: 'tickdeck Storybook',
    // The playground's landing page, one level up on the hosted site.
    brandUrl: '../',
    brandTarget: '_self',
  }),
});
