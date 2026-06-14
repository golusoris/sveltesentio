# Visual regression — Playwright snapshots + Lost-Pixel anchor

Visual regression catches styling regressions that unit tests and axe
miss: unintended border-radius changes, broken dark-mode overrides,
layout shifts from a Tailwind utility rename. The contract anchors on
**Histoire story URLs** (see [histoire-stories.md](histoire-stories.md))
so one story drives three lanes:

1. **Manual review** — reviewer opens the Histoire preview URL.
2. **A11y** — axe-core runs per story in component tests.
3. **Visual regression** — this recipe.

Two tools cover the visual-regression lane: **Playwright** for
end-to-end page snapshots (route-level), **Lost-Pixel** for story-level
component snapshots. They are complementary, not alternatives.

## Related

- [histoire-stories.md](histoire-stories.md) — story authoring
  conventions that anchor snapshots.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core triage.
- [theming.md](theming.md) — dark/light parity; every snapshot pair.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — RTL snapshot
  locales.
- [pwa.md](pwa.md) — service-worker-aware Playwright config.
- [ADR-0031](../adr/0031-a11y-testing-lane.md) — testing lane preset.

## When to use what

```text
Full route / page layout / flow                → Playwright
One component across variants                  → Lost-Pixel (Histoire-anchored)
Canvas / WebGL / media pixels                  → Playwright with mask
Flash-free SSR theme hydration                 → Playwright (SSR required)
PWA install prompt / offline shell             → Playwright (real SW)
RTL / locale-specific layout                   → Playwright per locale
```

Lost-Pixel against Histoire covers the component matrix cheaply.
Playwright handles anything that requires a real page context (SSR,
service worker, URL params, cookies, network).

## Playwright install

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium firefox webkit
```

`playwright.config.ts` at the app / package root:

```ts
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 200,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
    { name: 'mobile-chrome', use: devices['Pixel 7'] },
    { name: 'mobile-safari', use: devices['iPhone 14'] },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

`baseURL` points to **preview**, not **dev** — preview runs the built
bundle, which is what ships. Dev-server output differs (HMR markers,
un-minified CSS, source-map comments).

## Snapshot hygiene — the four invariants

Screenshots must be deterministic. Four invariants, all enforced in
`expect.toHaveScreenshot`:

1. **`animations: 'disabled'`** — CSS transitions + Svelte transitions
   collapse to 0 ms. Otherwise the first frame differs per run.
2. **`caret: 'hide'`** — input caret blink is the #1 cause of
   flake in form snapshots.
3. **`scale: 'css'`** — DPR normalisation. Mobile devices use DPR 3;
   snapshot at CSS pixels so the image is GPU-independent.
4. **`maxDiffPixels: 200`** — tiny threshold for sub-pixel AA drift.
   Anything ≥200 px delta is a real change.

A fifth invariant belongs in the fixture, not the config:
**`await page.evaluate(() => document.fonts.ready)`** before every
screenshot. FOUT (flash of unstyled text) wrecks snapshots more than
anything else.

## Fixture: stable snapshot helpers

```ts
// tests/e2e/_fixtures.ts
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{
  prep: (url: string) => Promise<void>;
}>({
  prep: async ({ page }, use) => {
    const prep = async (url: string) => {
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({
        content: `*, *::before, *::after {
          animation-duration: 0s !important;
          transition-duration: 0s !important;
        }`,
      });
    };
    await use(prep);
  },
});

export { expect };
```

Every visual test starts with `await prep(url)`. Fonts-ready + idle +
animation-kill gives reproducible pixels.

## Dark + light parity snapshot

```ts
import { test, expect } from './_fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`dashboard @${theme}`, async ({ page, prep }) => {
    await page.context().addCookies([{
      name: 'theme',
      value: theme,
      url: 'http://localhost:4173',
    }]);
    await prep('/dashboard');
    await expect(page).toHaveScreenshot(`dashboard-${theme}.png`);
  });
}
```

Pair every route with both themes. The cookie contract comes from
[theming-flash-free.md](theming-flash-free.md) — set it before
navigation so SSR renders the right theme and there's no flash.

## RTL snapshot

```ts
for (const locale of ['en', 'ar', 'he'] as const) {
  test(`checkout @${locale}`, async ({ page, prep }) => {
    await page.context().addCookies([{
      name: 'PARAGLIDE_LOCALE',
      value: locale,
      url: 'http://localhost:4173',
    }]);
    await prep('/checkout');
    await expect(page).toHaveScreenshot(`checkout-${locale}.png`);
  });
}
```

Logical properties (per [i18n-runtime-strategy.md](i18n-runtime-strategy.md))
flip automatically; the snapshot proves they did.

## Masking volatile regions

Timestamps, random IDs, avatar colors, chart canvases need masking:

```ts
await expect(page).toHaveScreenshot('orders.png', {
  mask: [
    page.locator('[data-testid="timestamp"]'),
    page.locator('canvas'),
    page.locator('[data-avatar]'),
  ],
});
```

`data-testid` on volatile leaves is worth the one line of markup. Never
mask with CSS selectors that span layout — you'll hide real regressions.

## Lost-Pixel for story-level

Lost-Pixel runs against the **Histoire build output** and snapshots
each story. Install:

```bash
pnpm add -D lost-pixel
```

`lostpixel.config.ts`:

```ts
import { CustomProjectConfig } from 'lost-pixel';

export const config: CustomProjectConfig = {
  histoireShots: {
    histoireUrl: './packages/ui/dist-histoire',
  },
  lostPixelProjectId: 'sveltesentio-ui',
  ciBuildId: process.env.GITHUB_SHA,
  ciBuildNumber: process.env.GITHUB_RUN_NUMBER,
  threshold: 0.002,
  shotConcurrency: 4,
  timeouts: { fetchStories: 60_000, loadState: 20_000 },
  waitBeforeScreenshot: 500,
  imagePathBaseline: './.lostpixel/baseline',
  imagePathCurrent: './.lostpixel/current',
  imagePathDifference: './.lostpixel/difference',
};
```

Run:

```bash
pnpm --filter @sveltesentio/ui histoire:build
pnpm exec lost-pixel
```

One snapshot per Variant in every Story. A new variant automatically
gets a baseline on first run; subsequent runs diff against it.

## Baseline management

Baselines live in git. Never commit a regenerated baseline without
reviewing the diff — the whole point is human review.

```bash
pnpm exec lost-pixel update   # regenerate baseline
pnpm exec playwright test --update-snapshots
```

Gate these commands behind an explicit flag in CI so nobody rubber-stamps
a regression as an update.

## CI: parallel lanes, distinct triggers

```yaml
# .github/workflows/visual.yml (excerpt)
jobs:
  component-visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @sveltesentio/ui histoire:build
      - run: pnpm exec lost-pixel
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: lostpixel-diff
          path: .lostpixel/difference

  route-visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium firefox webkit
      - run: pnpm -w test:visual
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

Component-visual runs on every PR; route-visual runs on every PR for
chromium and nightly for the full matrix. Route-visual on webkit/mobile
is slow — gate to nightly unless the PR label `visual:full` forces it.

## Gotchas

- **Linux vs macOS renders differ.** Pin CI to `ubuntu-latest`. Baselines
  captured on macOS locally will not match. Use `playwright docker`
  locally or regenerate inside the CI image.
- **System fonts differ per OS.** Lock to webfonts or use
  `@fontsource` self-hosted per [ADR-0049](../adr/0049-system-font-default-fontsource-optin.md);
  never rely on `system-ui` for visually-regressed surfaces.
- **Subpixel antialiasing.** Chromium and Firefox render AA slightly
  differently. `maxDiffPixels: 200` absorbs it; don't raise without
  investigating what changed.
- **`prefers-reduced-motion`.** Playwright matches the host; set
  explicitly:
  `page.emulateMedia({ reducedMotion: 'reduce' })` for the reduced-motion
  snapshot pair.
- **Charts / canvas / media.** Mask the canvas; assert on the table
  fallback per [charts-realtime.md](charts-realtime.md) and
  [charts-exotic.md](charts-exotic.md).
- **Service-worker state across runs.** PWA tests need a clean SW state
  per spec; use `await context.clearCookies()` + `await context.storageState({ path: undefined })`
  and/or spawn a fresh `browserContext` per spec.

## Component-level: Playwright Component Testing (secondary)

Playwright has first-class component testing, but for Svelte the story
is more fragile than Vitest + jest-axe + Lost-Pixel. Default to the
latter. Reach for Playwright Component Testing only when a component
needs real-browser APIs (IntersectionObserver timing, WebGPU, `document.fonts`
behavior) that jsdom can't provide.

## Anti-patterns

- **Screenshots without `animations: 'disabled'`.** Flaky forever.
  Every snapshot config sets it.
- **Screenshots without `document.fonts.ready`.** FOUT breaks diff
  comparison on every run. Always wait.
- **Snapshotting charts / canvases without masking.** GPU-dependent
  pixels. Mask the canvas, assert on the table fallback.
- **Single-theme snapshots.** Dark / light parity is a first-class
  contract — both themes for every route.
- **Raising `maxDiffPixels` to silence a failure.** Investigate first.
  The threshold exists for AA noise, not real regressions.
- **Committing regenerated baselines without review.** The whole point
  of visual regression is human review; auto-updating defeats it.
- **Running the full device matrix on every PR.** Slow; gate to
  chromium-only on PR and full matrix nightly (or via explicit label).
- **Snapshotting `networkidle` without setting a timeout.** Some pages
  never go idle (analytics polling, WebSocket heartbeat). Set
  `waitUntil: 'domcontentloaded'` + explicit asserts for flaky cases.
- **Using `page.screenshot` instead of `expect(page).toHaveScreenshot`.**
  Raw `screenshot` skips the Playwright diff pipeline and threshold
  config. Always go through `expect`.
- **Testing against dev-server.** HMR + source maps pollute the DOM.
  Always snapshot against `pnpm preview` (built bundle).
- **Baselines on macOS / Windows committed to git.** Linux-only
  baselines, CI-reproducible. Regenerate in container.
- **Lost-Pixel without threshold.** `threshold: 0` blocks every AA
  change. Start at `0.002` (0.2%) and tighten per component.
- **Percy / Chromatic as the default.** Paid SaaS where Lost-Pixel +
  self-hosted histoire build covers the same ground. Only reach for
  them if the team needs the collaboration UI (cost-benefit per
  consumer, not a framework default).

## References

- [histoire-stories.md](histoire-stories.md) — story conventions that
  anchor snapshots.
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — axe-core lane.
- [theming-flash-free.md](theming-flash-free.md) — cookie contract
  that drives the dark/light snapshot pair.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — RTL locale
  matrix.
- [pwa.md](pwa.md) — service-worker Playwright config.
- [ADR-0031](../adr/0031-a11y-testing-lane.md) — a11y testing lane.
- [ADR-0049](../adr/0049-system-font-default-fontsource-optin.md) —
  font stack for reproducible text rendering.
- Playwright: <https://playwright.dev>.
- Lost-Pixel: <https://lost-pixel.com>.
