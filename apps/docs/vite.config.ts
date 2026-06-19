import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: {
      // Markdown sources + package manifests live above the app root.
      allow: ['..', '../..'],
    },
  },
});
