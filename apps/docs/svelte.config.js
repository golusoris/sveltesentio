import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import { remarkEscapeSvelte } from './mdsvex/remark-escape-svelte.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  extensions: ['.svelte', '.md'],
  preprocess: [
    vitePreprocess(),
    mdsvex({
      extensions: ['.md'],
      remarkPlugins: [remarkEscapeSvelte],
    }),
  ],
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: undefined,
      precompress: false,
      strict: true,
    }),
    prerender: {
      // The site's own routes are reached via the sidebar nav (an entry per
      // doc slug) and the catch-all `entries` generator. The rendered markdown
      // also carries the docs' original *relative* cross-references — links to
      // sibling `.md` files, repo paths (`AGENTS.md`, `packages/…`), and ADRs by
      // filename. Those are intentional source cross-refs, not app routes, so a
      // 404 from a `.md`/repo link is expected; fail only on genuine errors.
      handleHttpError: ({ status, path, referrer, message }) => {
        // A 404 here means the crawler followed one of the docs' original
        // relative cross-references to something that is not a site route
        // (`.md`/`.puml`/`.yml` files, repo paths, the Storybook build). Those
        // are expected dead links in a docs-only render — ignore them. Any
        // other status is a genuine failure and must stop the build.
        if (status === 404) return;
        throw new Error(`${message} (${path} from ${referrer})`);
      },
      handleMissingId: 'warn',
    },
  },
};

export default config;
