import { defineConfig } from '@playwright/test';

const PORT = 6007;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './visual',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
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
		command: `storybook dev -p ${PORT} --no-open --ci`,
		url: BASE_URL,
		reuseExistingServer: false,
		timeout: 120_000,
	},
	expect: {
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.01,
		},
	},
});
