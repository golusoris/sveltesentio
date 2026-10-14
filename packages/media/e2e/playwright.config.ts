import { defineConfig, devices } from '@playwright/test';

// Playwright e2e config for @sveltesentio/media — keyboard-shortcut playback
// (media/AGENTS.md "<Player> a11y: Vidstack-parity keyboard map"). Runs in
// Chromium, Firefox and WebKit; a Vite dev server serves the mount-page
// harness in `e2e/app`. The `lighthouse` project audits the production build
// of the same harness, served by `vite preview`. Kept fully separate from the Vitest coverage gate
// (`pnpm test`) — specs live in `e2e/*.spec.ts`, never `test/*.test.ts`. Paths
// resolve relative to `e2e/`.
const PORT = 4318;
// The production build of the same harness, for the Lighthouse spec.
const PREVIEW_PORT = 4319;
const LIGHTHOUSE_SPEC = '**/lighthouse.spec.ts';

export default defineConfig({
	testDir: '.',
	testMatch: '**/*.spec.ts',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			testIgnore: LIGHTHOUSE_SPEC,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'firefox',
			testIgnore: LIGHTHOUSE_SPEC,
			use: { ...devices['Desktop Firefox'] },
		},
		{
			name: 'webkit',
			testIgnore: LIGHTHOUSE_SPEC,
			use: { ...devices['Desktop Safari'] },
		},
		// Lighthouse drives Chromium over the DevTools protocol, so it runs once,
		// in Chromium, against `vite preview` of the production build.
		{
			name: 'lighthouse',
			testMatch: LIGHTHOUSE_SPEC,
			use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PREVIEW_PORT}` },
		},
	],
	webServer: [
		{
			command: `pnpm exec vite --config vite.config.ts --port ${PORT}`,
			cwd: import.meta.dirname,
			url: `http://localhost:${PORT}`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
		{
			command: `pnpm exec vite build --config vite.config.ts && pnpm exec vite preview --config vite.config.ts --port ${PREVIEW_PORT}`,
			cwd: import.meta.dirname,
			url: `http://localhost:${PREVIEW_PORT}`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
	],
});
