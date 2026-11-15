import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Guards the markdown reader layout (gap audit C15-2, issue #501): code blocks,
 * callouts and sidebar navigation on apps/docs/src/routes/docs/[...slug], and
 * reflow down to 320 CSS px (WCAG 2.2 SC 1.4.10).
 */

const DESKTOP = { width: 1280, height: 800 } as const;
const VIEW_HEIGHT = 800;
/** SC 1.4.10 reflow width. */
const MIN_WIDTH = 320;
/** 768 sits on the 48rem layout breakpoint, which `max-width` includes. */
const REFLOW_WIDTHS = [MIN_WIDTH, 375, 768, 1024] as const;
const REFLOW_SLUGS = [
	'principles',
	'compose/progressive-enhancement',
	'compose/connectrpc',
] as const;
/** Page with many code blocks, a leading callout and Svelte markup inside code fences. */
const CODE_SLUG = 'compose/progressive-enhancement';
/** Layout boxes land on fractional pixels; allow half a pixel of rounding. */
const SUBPIXEL = 0.5;
/** Explicit deadline for each navigation and poll (HISS-02); the local preview answers in well under 1 s. */
const NAV_TIMEOUT_MS = 15_000;
/**
 * A computed colour with zero alpha, in legacy `rgba(..., 0)` or modern `... / 0)` form. Only
 * the rgba form is matched by its last comma, so an opaque `rgb(r, g, 0)` does not count.
 */
const ZERO_ALPHA = /^transparent$|^rgba\(.*,\s*0\)$|\/\s*0\)$/;

function docLink(page: Page, slug: string): Locator {
	return page.locator(`aside.sidebar a[href$="/docs/${slug}"]`);
}

/** Opens a reader page and fails if the slug no longer resolves, so layout checks never run on the 404 page. */
async function openDoc(page: Page, slug: string): Promise<void> {
	const response = await page.goto(`/docs/${slug}`, { timeout: NAV_TIMEOUT_MS });
	expect(response?.status(), `/docs/${slug} loads`).toBe(200);
}

async function styleOf(locator: Locator, property: string): Promise<string> {
	return locator.evaluate(
		(element, name) => getComputedStyle(element).getPropertyValue(name),
		property,
	);
}

async function boxOf(locator: Locator): Promise<{ x: number; width: number }> {
	const box = await locator.boundingBox();
	expect(box, 'element has a layout box').not.toBeNull();
	return box ?? { x: Number.NaN, width: Number.NaN };
}

test.describe('apps/docs markdown reader (C15-2)', () => {
	test('code blocks render as scrollable monospace text (positive)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, CODE_SLUG);

		const blocks = page.locator('article.prose pre');
		const total = await blocks.count();
		expect(total).toBeGreaterThanOrEqual(1);
		await expect(page.locator('article.prose pre > code')).toHaveCount(total);

		const first = blocks.first();
		await expect(first).toBeVisible();
		// The UA stylesheet already gives <code> a bare `monospace`; assert the docs stack.
		expect(await styleOf(first.locator('code'), 'font-family')).toContain('ui-monospace');
		expect(await styleOf(first, 'overflow-x')).toBe('auto');

		// Svelte markup inside a code fence stays text instead of becoming live DOM: a live
		// <form> would not render its attributes as text.
		await expect(blocks.filter({ hasText: 'form method="POST"' }).first()).toBeVisible();
		await expect(page.locator('article.prose pre form, article.prose pre aside')).toHaveCount(0);
	});

	test('callout keeps its left border inside the article (positive)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, CODE_SLUG);

		const callout = page.locator('article.prose blockquote').first();
		await expect(callout).toBeVisible();
		await expect(callout).not.toBeEmpty();
		expect(await styleOf(callout, 'border-left-style')).toBe('solid');
		expect(await styleOf(callout, 'border-left-width')).toBe('4px');
		// A solid 4 px border in a transparent colour still passes the two checks above.
		expect(await styleOf(callout, 'border-left-color')).not.toMatch(ZERO_ALPHA);

		const box = await boxOf(callout);
		const article = await boxOf(page.locator('article.prose'));
		expect(box.x).toBeGreaterThanOrEqual(article.x - SUBPIXEL);
		expect(box.x + box.width).toBeLessThanOrEqual(article.x + article.width + SUBPIXEL);
	});

	test('sidebar marks the current page and follows navigation (positive)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, 'principles');

		const sidebar = page.getByRole('complementary', { name: 'Documentation navigation' });
		await expect(sidebar).toBeVisible();
		const current = sidebar.locator('a[aria-current="page"]');
		await expect(current).toHaveCount(1);
		await expect(docLink(page, 'principles')).toHaveAttribute('aria-current', 'page');
		await expect(docLink(page, 'principles')).toHaveClass(/\bactive\b/);
		const heading = page.locator('article.prose h1').first();
		const firstTitle = (await heading.textContent()) ?? '';
		expect(firstTitle).not.toBe('');

		await docLink(page, CODE_SLUG).click({ timeout: NAV_TIMEOUT_MS });
		await expect(page).toHaveURL((url) => url.pathname.endsWith(`/docs/${CODE_SLUG}`), {
			timeout: NAV_TIMEOUT_MS,
		});
		// not.toHaveText alone also passes when the destination renders no heading at all.
		await expect(heading).toBeVisible({ timeout: NAV_TIMEOUT_MS });
		await expect(heading).toHaveText(/\S/);
		await expect(heading).not.toHaveText(firstTitle);
		await expect(current).toHaveCount(1);
		await expect(docLink(page, CODE_SLUG)).toHaveAttribute('aria-current', 'page');
		await expect(docLink(page, 'principles')).not.toHaveAttribute('aria-current');
	});

	test('sidebar stays pinned beside the content while the page scrolls (positive)', async ({
		page,
	}) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, 'principles');

		await page.evaluate(() => {
			window.scrollTo(0, 2000);
		});
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: NAV_TIMEOUT_MS })
			.toBeGreaterThan(0);

		const aside = await page.locator('aside.sidebar').evaluate((element) => {
			const rect = element.getBoundingClientRect();
			return { top: rect.top, height: rect.height, right: rect.right };
		});
		const mainLeft = await page
			.locator('main#main')
			.evaluate((element) => element.getBoundingClientRect().left);
		expect(aside.top).toBe(0);
		expect(Math.abs(aside.height - VIEW_HEIGHT)).toBeLessThanOrEqual(1);
		expect(mainLeft).toBeGreaterThanOrEqual(aside.right - SUBPIXEL);
	});

	test('an unknown slug marks no sidebar link as current (negative)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		const response = await page.goto('/docs/this-slug-does-not-exist-ever', {
			timeout: NAV_TIMEOUT_MS,
		});
		expect(response?.status()).toBe(404);

		const sidebar = page.locator('aside.sidebar');
		await expect(sidebar).toBeVisible();
		await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(0);
		await expect(sidebar.locator('a.active')).toHaveCount(0);
	});

	for (const width of REFLOW_WIDTHS) {
		test(`reader pages fit a ${width} px viewport without sideways scrolling (boundary)`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: VIEW_HEIGHT });
			for (const slug of REFLOW_SLUGS) {
				await openDoc(page, slug);
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth,
				);
				expect.soft(overflow, `/docs/${slug} overflows at ${width} px`).toBeLessThanOrEqual(0);
			}
		});
	}

	test('code blocks scroll inside their own box at 320 px (boundary)', async ({ page }) => {
		await page.setViewportSize({ width: MIN_WIDTH, height: VIEW_HEIGHT });
		await openDoc(page, CODE_SLUG);

		const blocks = await page.locator('article.prose pre').evaluateAll((nodes) =>
			nodes.map((node) => ({
				scrolls: node.scrollWidth > node.clientWidth,
				overflowX: getComputedStyle(node).overflowX,
				right: node.getBoundingClientRect().right,
			})),
		);
		expect(blocks.length).toBeGreaterThanOrEqual(1);
		expect(blocks.some((block) => block.scrolls)).toBe(true);
		// scrollWidth > clientWidth also holds for overflow-x: hidden, which clips instead of scrolling.
		expect(blocks.filter((block) => block.overflowX !== 'auto')).toEqual([]);
		const widestRight = Math.max(...blocks.map((block) => block.right));
		expect(widestRight).toBeLessThanOrEqual(MIN_WIDTH + SUBPIXEL);
	});
});
