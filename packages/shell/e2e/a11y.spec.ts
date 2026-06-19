import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeConfig, filterPlaywrightViolations } from '@sveltesentio/testing/playwright-axe';
import type { AxeViolation } from '@sveltesentio/testing/a11y';

// axe-core WCAG 2.2 AA sweep of the rendered shell layout, gated to the same
// serious/critical impact set as the in-process component lane (ADR-0031). Tags
// + impact gate come straight from `@sveltesentio/testing/playwright-axe`,
// proving that fixture preset composes with `@axe-core/playwright`.

/** Run axe over the live page and return the serious/critical violations. */
async function sweep(page: Page): Promise<readonly AxeViolation[]> {
  const config = axeConfig();
  // AxeBuilder's `withTags`/`disableRules` take mutable arrays; the preset
  // exposes its values as `readonly`, so copy them through.
  let builder = new AxeBuilder({ page }).withTags([...config.tags]);
  if (config.disableRules.length > 0) builder = builder.disableRules([...config.disableRules]);
  const results = await builder.analyze();
  return filterPlaywrightViolations(
    results.violations as unknown as readonly AxeViolation[],
    config.impactsFail,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#shell-root')).toBeVisible();
});

test('shell layout has no serious/critical WCAG 2.2 AA violations', async ({ page }) => {
  const violations = await sweep(page);
  expect(
    violations,
    violations.map((v) => `[${v.impact}] ${v.id} — ${v.description}`).join('\n'),
  ).toEqual([]);
});

test('the focus grid is reachable as labelled interactive controls', async ({ page }) => {
  // Sanity: the sweep target actually contains the interactive surface, so the
  // clean result above is meaningful (not an empty/landmark-only page).
  const grid = page.locator('#focus-grid[role="grid"][aria-label]');
  await expect(grid).toBeVisible();
  const cells = page.locator('[data-cell]');
  await expect(cells).toHaveCount(9);
  // Every cell exposes an accessible name to axe / AT.
  for (const cell of await cells.all()) {
    await expect(cell).toHaveAccessibleName(/Cell \d-\d/);
  }
});

test('the primary navigation landmark is labelled', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(3);
});
