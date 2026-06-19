import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e for @sveltesentio/auth's MFA + passkey flows (auth/AGENTS.md —
 * WebAuthn virtual authenticator). This is a SEPARATE lane from the blocking
 * `test` task (vitest + coverage); it never gates `make ci`'s unit run.
 *
 * Approach: a tiny Vite-built harness (`e2e/harness`) mounts the REAL Svelte 5
 * `MfaChallenge` / `MfaEnroll` components and the REAL `registerPasskey`
 * ceremony, served by `vite preview`. Chosen over `@playwright/experimental-ct-svelte`
 * because that package pins `@sveltejs/vite-plugin-svelte@^5` + `vite@^6`, two
 * majors behind this repo's vite-plugin-svelte@7 / vite@8 — it cannot compile the
 * package's own Svelte 5 output without dragging in a conflicting toolchain.
 *
 * The passkey test attaches a CDP WebAuthn virtual authenticator
 * (`WebAuthn.addVirtualAuthenticator`) so `navigator.credentials.create`
 * resolves headlessly with no physical key.
 */
const HOST = 'localhost';
const PORT = 5187;
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		// Build the harness, then serve the static output. `vite preview` binds the
		// fixed strictPort from vite.config.ts so baseURL stays stable. A fresh
		// server is always started (no reuse) so the e2e run can never bind onto an
		// unrelated loopback dev server in a shared sandbox.
		command: 'vite build --config vite.config.ts && vite preview --config vite.config.ts',
		url: BASE_URL,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
