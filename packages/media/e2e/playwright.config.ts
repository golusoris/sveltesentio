import { defineConfig, devices } from '@playwright/test';

// Playwright e2e config for @sveltesentio/media — keyboard-shortcut playback
// (media/AGENTS.md "<Player> a11y: Vidstack-parity keyboard map"). Chromium-only;
// a Vite dev server serves the mount-page harness in `e2e/app`. Kept fully
// separate from the Vitest coverage gate (`pnpm test`) — specs live in
// `e2e/*.spec.ts`, never `test/*.test.ts`. Paths resolve relative to `e2e/`.
const PORT = 4318;

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
