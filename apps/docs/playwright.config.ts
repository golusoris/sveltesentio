import { defineConfig } from '@playwright/test';

const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: BASE_URL,
	},
	projects: [
		{
			name: 'chromium',
			use: {
				browserName: 'chromium',
				viewport: { width: 1280, height: 720 },
			},
		},
	],
	webServer: {
		command: 'pnpm build && pnpm preview',
		url: BASE_URL,
		reuseExistingServer: false,
		timeout: 240_000,
	},
});
