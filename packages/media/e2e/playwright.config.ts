import { defineConfig, devices } from '@playwright/test';

// Playwright e2e config for @sveltesentio/media — keyboard-shortcut playback
// (media/AGENTS.md "<Player> a11y: Vidstack-parity keyboard map"). Runs in
// Chromium, Firefox and WebKit against the production build of the mount-page
// harness in `e2e/app`, served by `vite preview`: the Web Vitals budgets in
// every spec measure shipped output, not the unbundled dev server (about
// 2.4 MB on first load, whose cold FCP on hosted runners exceeds the budget).
// The `lighthouse` project audits the same build. Kept fully separate from the Vitest coverage gate
// (`pnpm test`) — specs live in `e2e/*.spec.ts`, never `test/*.test.ts`. Paths
// resolve relative to `e2e/`.
const PORT = 4319;
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
		// Lighthouse drives Chromium over the DevTools protocol, so it runs once.
		{
			name: 'lighthouse',
			testMatch: LIGHTHOUSE_SPEC,
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: `pnpm exec vite build --config vite.config.ts && pnpm exec vite preview --config vite.config.ts --port ${PORT}`,
		cwd: import.meta.dirname,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
