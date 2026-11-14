import { expect, test } from '@playwright/test';

test.describe('apps/docs e2e', () => {
	test('homepage renders package grid and hero actions (C15-1)', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('h1')).toContainText('sveltesentio');
		await expect(page.getByRole('heading', { name: /^Packages/ })).toBeVisible();

		const packageCards = page.locator('.package-grid a, .package-grid li, .packages a');
		expect(await packageCards.count()).toBeGreaterThanOrEqual(1);

		const heroLinks = page.locator('.hero-actions a');
		expect(await heroLinks.count()).toBeGreaterThanOrEqual(1);
		await expect(heroLinks.first()).toBeVisible();

		await expect(page).toHaveTitle(/sveltesentio/);
	});

	test('markdown doc page renders prose content and heading (C15-2)', async ({ page }) => {
		await page.goto('/docs/principles');

		const prose = page.locator('article.prose');
		await expect(prose).toBeVisible();
		await expect(prose).not.toBeEmpty();

		const heading = prose.locator('h1').first();
		await expect(heading).toBeVisible();
		await expect(prose.locator('p').first()).toBeVisible();
	});

	test('unknown slug displays 404 error page with back link', async ({ page }) => {
		const response = await page.goto('/docs/this-slug-does-not-exist-ever');
		expect(response?.status()).toBe(404);

		await expect(page.locator('h1')).toContainText('404');
		await expect(page.getByRole('link', { name: 'Back to overview' })).toBeVisible();
	});

	test('empty slug redirects to homepage or displays 404', async ({ page }) => {
		const response = await page.goto('/docs/');

		const pathname = new URL(page.url()).pathname;
		const isHomepage = pathname === '/' || pathname === '';
		const h1Text = (await page.locator('h1').textContent()) ?? '';
		const is404 = h1Text.includes('404') || (response !== null && response.status() === 404);

		expect(isHomepage || is404).toBe(true);
	});
});
