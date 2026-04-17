import { defineConfig } from 'histoire';
import { HstSvelte } from '@histoire/plugin-svelte';

export default defineConfig({
  plugins: [HstSvelte()],
  storyMatch: ['stories/**/*.story.svelte'],
  tree: {
    groups: [
      { id: 'ui', title: '@sveltesentio/ui' },
    ],
  },
  vite: {
    css: {
      preprocessorOptions: {},
    },
  },
});
