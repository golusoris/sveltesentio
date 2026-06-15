import type { Preview } from '@storybook/svelte-vite';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // axe runs on every story; surface violations but don't fail the build.
      test: 'todo',
    },
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default preview;
