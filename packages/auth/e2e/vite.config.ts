import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

/**
 * Vite config for the Playwright e2e harness (auth/AGENTS.md — WebAuthn virtual
 * authenticator). Uses the package's own `@sveltejs/vite-plugin-svelte@7` so the
 * real Svelte 5 components compile against the runtime the package ships — no
 * coupling to the experimental Playwright CT plugin (which pins
 * vite-plugin-svelte@5 / vite@6 and lags two majors behind this repo).
 *
 * Root is `e2e/harness`; the build output stays inside `e2e/dist` (gitignored,
 * never published) and is served by Playwright's `webServer` via `vite preview`.
 *
 * Host is `localhost` (NOT a raw IP): WebAuthn requires the RP id to be a
 * registrable suffix of the origin's domain and rejects `127.0.0.1` as an
 * "invalid domain", whereas `localhost` is a valid RP id and a trustworthy
 * origin over plain HTTP. Port is pinned + strict so the e2e baseURL is stable.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const HOST = 'localhost';
const PORT = 5187;

export default defineConfig({
	root: resolve(here, 'harness'),
	plugins: [svelte()],
	build: {
		outDir: resolve(here, 'dist'),
		emptyOutDir: true,
	},
	server: { host: HOST, port: PORT, strictPort: true },
	preview: { host: HOST, port: PORT, strictPort: true },
});
