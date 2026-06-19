import { defineConfig } from 'vite';

// Dev server for the Playwright e2e harness. Roots at `e2e/app` so Vite serves
// the hand-built mount page (`index.html` → `main.ts`) which imports the real
// `src/` primitives. No Svelte plugin is needed — the harness drives the
// framework-agnostic `dpadNavigation` action directly, sidestepping
// Playwright-CT-for-Svelte-5 support gaps.
export default defineConfig({
  root: new URL('./app', import.meta.url).pathname,
  server: {
    port: 4317,
    strictPort: true,
  },
  preview: {
    port: 4317,
    strictPort: true,
  },
});
