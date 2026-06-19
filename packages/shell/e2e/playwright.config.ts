import { defineConfig, devices } from '@playwright/test';

// Playwright e2e config for @sveltesentio/shell (shell/AGENTS.md "Integration
// (planned): Playwright a11y sweep + arrow-key/gamepad navigation under each
// interface type"). Chromium-only; a Vite dev server serves the mount-page
// harness in `e2e/app`. Kept fully separate from the Vitest coverage gate
// (`pnpm test`) — specs live in `e2e/*.spec.ts`, never `test/*.test.ts`. All
// paths below resolve relative to this file's directory (`e2e/`).
const PORT = 4317;

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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --config vite.config.ts --port ${PORT}`,
    cwd: import.meta.dirname,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
