import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Guards the markdown reader layout (gap audit C15-2, issue #501): code blocks,
 * callouts and sidebar navigation on apps/docs/src/routes/docs/[...slug], and
 * reflow of every reader page down to 320 CSS px (WCAG 2.2 SC 1.4.10).
 */

const DESKTOP = { width: 1280, height: 800 } as const;
const VIEW_HEIGHT = 800;
/** SC 1.4.10 reflow width. */
const MIN_WIDTH = 320;
/** 768 sits on the 48rem layout breakpoint, which `max-width` includes. */
const REFLOW_WIDTHS = [MIN_WIDTH, 375, 768, 1024, DESKTOP.width] as const;
/** The pages that overflowed on `main` before the reflow fix; the page walk must still reach them. */
const KNOWN_WIDE_SLUGS = [
	'principles',
	'compose/progressive-enhancement',
	'compose/connectrpc',
] as const;
/** Upper bound for the page walk (HISS-02); the sidebar lists the whole registry, 197 pages today. */
const MAX_READER_PAGES = 400;
/** Deadline for the whole page walk; 197 pages at five widths took 20 s locally with four workers. */
const PAGE_WALK_TIMEOUT_MS = 240_000;
/** Page with many code blocks, a leading callout and Svelte markup inside code fences. */
const CODE_SLUG = 'compose/progressive-enhancement';
/** Layout boxes land on fractional pixels; allow half a pixel of rounding. */
const SUBPIXEL = 0.5;
/** Explicit deadline for each navigation and poll (HISS-02); the local preview answers in well under 1 s. */
const NAV_TIMEOUT_MS = 15_000;
/** One just noticeable difference as an OKLab distance (deltaEOK), from CSS Color 4 §14.2.1. */
const OKLAB_JND = 0.02;
/** Ancestors searched for an opaque background behind the callout (HISS-02). */
const MAX_BACKGROUND_DEPTH = 32;
/** A computed colour reads `oklab(L a b)`, with ` / alpha` added only below full opacity. */
const OKLAB_PREFIX = 'oklab(';
const ALPHA_SEPARATOR = ' / ';

interface Oklab {
	l: number;
	a: number;
	b: number;
	alpha: number;
}

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

/** Splits the string instead of matching a regular expression, so no input can backtrack. */
function parseOklab(css: string): Oklab {
	const wrapped = css.startsWith(OKLAB_PREFIX) && css.endsWith(')');
	const inner = wrapped ? css.slice(OKLAB_PREFIX.length, -1) : '';
	const [channels = '', alpha = '1', ...extra] = inner.split(ALPHA_SEPARATOR);
	const parts = [...channels.split(' '), alpha];
	const values = parts.map((part) => (part === '' ? Number.NaN : Number(part)));
	const valid = extra.length === 0 && parts.length === 4 && values.every(Number.isFinite);
	expect(valid, `${css} is a computed oklab() colour`).toBe(true);
	const [l = 0, a = 0, b = 0, opacity = 0] = values;
	return { l, a, b, alpha: opacity };
}

function deltaEOK(one: Oklab, two: Oklab): number {
	return Math.hypot(one.l - two.l, one.a - two.a, one.b - two.b);
}

/**
 * Reads the callout's left border colour and the background colours of its ancestors, starting
 * at its parent: the border's outer edge meets the page, not the callout's own fill. The browser
 * converts each one to OKLab, so any authored colour form compares.
 */
async function calloutColours(callout: Locator): Promise<{ border: Oklab; backgrounds: Oklab[] }> {
	const colours = await callout.evaluate((element, maxDepth) => {
		// Test instrumentation: an unstyled probe resolves each colour, then always leaves the page.
		const probe = document.createElement('span');
		document.body.append(probe);
		try {
			const toOklab = (color: string): string => {
				probe.style.color = `oklab(from ${color} l a b / alpha)`;
				return getComputedStyle(probe).color;
			};
			const backgrounds: string[] = [];
			let node: Element | null = element.parentElement;
			for (let depth = 0; node !== null && depth < maxDepth; depth += 1) {
				backgrounds.push(toOklab(getComputedStyle(node).backgroundColor));
				node = node.parentElement;
			}
			return { border: toOklab(getComputedStyle(element).borderLeftColor), backgrounds };
		} finally {
			probe.remove();
		}
	}, MAX_BACKGROUND_DEPTH);
	return { border: parseOklab(colours.border), backgrounds: colours.backgrounds.map(parseOklab) };
}

/** Every reader page in the sidebar, which lists the whole registry (`navGroups` in src/lib/docs.ts). */
async function readerSlugs(page: Page): Promise<string[]> {
	await page.setViewportSize(DESKTOP);
	await openDoc(page, KNOWN_WIDE_SLUGS[0]);
	const paths = await page
		.locator('aside.sidebar a[href*="/docs/"]')
		.evaluateAll((links) =>
			links.map((link) => new URL(link.getAttribute('href') ?? '', location.href).pathname),
		);
	const slugs = [...new Set(paths.map((path) => path.replace(/^\/docs\//, '')))];
	expect(slugs.length, 'the page walk stays inside its bound').toBeLessThanOrEqual(
		MAX_READER_PAGES,
	);
	expect(slugs).toEqual(expect.arrayContaining([...KNOWN_WIDE_SLUGS]));
	return slugs;
}

/**
 * Runs in the page: whether each element is drawn. It must not be hidden or transparent
 * (`checkVisibility` also reads the opacity of every ancestor, CSSOM View §6), its box must be
 * non-empty with both edges inside the viewport, and the topmost element at the centre of its box
 * must be inside it, which fails when `clip-path` or an overlay hides it.
 */
function drawnInPage(elements: Element[], subpixel: number): boolean[] {
	const inside = (element: Element): boolean => {
		if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
		const rect = element.getBoundingClientRect();
		const edges = rect.left >= -subpixel && rect.right <= window.innerWidth + subpixel;
		return rect.width > 0 && rect.height > 0 && edges;
	};
	// Scrolls only vertically, so horizontal edges and the document width stay as measured.
	const onTop = (element: Element): boolean => {
		const before = element.getBoundingClientRect();
		const centre = window.scrollY + before.top + before.height / 2;
		window.scrollTo({ top: centre - window.innerHeight / 2, behavior: 'instant' });
		const rect = element.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		return hit !== null && element.contains(hit);
	};
	return elements.map((element) => inside(element) && onTop(element));
}

async function drawn(locator: Locator): Promise<boolean[]> {
	return locator.evaluateAll(drawnInPage, SUBPIXEL);
}

/** Loads one reader page once, then lists each width where it scrolls sideways or hides its text. */
async function reflowFailures(page: Page, slug: string): Promise<string[]> {
	await openDoc(page, slug);
	const failures: string[] = [];
	for (const width of REFLOW_WIDTHS) {
		await page.setViewportSize({ width, height: VIEW_HEIGHT });
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		const [article = false] = await drawn(page.locator('article.prose'));
		const [heading = false] = await drawn(page.locator('article.prose h1').first());
		if (overflow > 0) failures.push(`/docs/${slug} at ${width} px: ${overflow} px wider`);
		if (!article) failures.push(`/docs/${slug} at ${width} px: article not drawn`);
		if (!heading) failures.push(`/docs/${slug} at ${width} px: heading not drawn`);
	}
	return failures;
}

test.describe('apps/docs reader code blocks (C15-2)', () => {
	test('code blocks render as scrollable monospace text (positive)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, CODE_SLUG);

		const blocks = page.locator('article.prose pre');
		const total = await blocks.count();
		expect(total).toBeGreaterThanOrEqual(1);
		await expect(page.locator('article.prose pre > code')).toHaveCount(total);

		const hidden = (await drawn(blocks)).flatMap((shown, index) => (shown ? [] : [index]));
		expect(hidden, 'every code block is drawn').toEqual([]);
		// The UA stylesheet already gives <code> a bare `monospace`; assert the docs stack on
		// every block, so a rule that only reaches a later block still fails.
		const styles = await blocks.evaluateAll((nodes) =>
			nodes.map((node) => ({
				font: getComputedStyle(node.querySelector('code') ?? node).fontFamily,
				overflowX: getComputedStyle(node).overflowX,
			})),
		);
		expect(styles.filter((style) => !style.font.includes('ui-monospace'))).toEqual([]);
		expect(styles.filter((style) => style.overflowX !== 'auto')).toEqual([]);

		// Svelte markup inside a code fence stays text instead of becoming live DOM: a live
		// <form> would not render its attributes as text.
		await expect(blocks.filter({ hasText: 'form method="POST"' }).first()).toBeVisible();
		await expect(page.locator('article.prose pre form, article.prose pre aside')).toHaveCount(0);
	});

	test('code blocks scroll inside their own box at 320 px (boundary)', async ({ page }) => {
		await page.setViewportSize({ width: MIN_WIDTH, height: VIEW_HEIGHT });
		await openDoc(page, CODE_SLUG);

		const pre = page.locator('article.prose pre');
		const blocks = await pre.evaluateAll((nodes) =>
			nodes.map((node) => ({
				scrolls: node.scrollWidth > node.clientWidth,
				overflowX: getComputedStyle(node).overflowX,
			})),
		);
		expect(blocks.length).toBeGreaterThanOrEqual(1);
		// At least one block is wider than 320 px, so this boundary case is exercised at all.
		expect(blocks.some((block) => block.scrolls)).toBe(true);
		// scrollWidth > clientWidth also holds for overflow-x: hidden, which clips instead of
		// scrolling, so every block, overflowing or not, must scroll on its own.
		expect(blocks.filter((block) => block.overflowX !== 'auto')).toEqual([]);
		const outside = (await drawn(pre)).flatMap((shown, index) => (shown ? [] : [index]));
		expect(outside, 'every code block is drawn inside the 320 px viewport').toEqual([]);
	});
});

test.describe('apps/docs reader callouts (C15-2)', () => {
	test('callout keeps its left border inside the article (positive)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, CODE_SLUG);

		const callout = page.locator('article.prose blockquote').first();
		await expect(callout).toBeVisible();
		await expect(callout).not.toBeEmpty();
		expect(await styleOf(callout, 'border-left-style')).toBe('solid');
		expect(await styleOf(callout, 'border-left-width')).toBe('4px');

		const box = await boxOf(callout);
		const article = await boxOf(page.locator('article.prose'));
		expect(box.x).toBeGreaterThanOrEqual(article.x - SUBPIXEL);
		expect(box.x + box.width).toBeLessThanOrEqual(article.x + article.width + SUBPIXEL);
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`callout border differs from the page background in ${colorScheme} mode (positive)`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme });
			await page.setViewportSize(DESKTOP);
			await openDoc(page, CODE_SLUG);

			const { border, backgrounds } = await calloutColours(
				page.locator('article.prose blockquote').first(),
			);
			// A transparent or translucent border would show the background instead of its own colour.
			expect(border.alpha, 'border colour is opaque').toBe(1);
			const background = backgrounds.find((colour) => colour.alpha === 1);
			expect(background, 'an opaque background sits behind the callout').toBeDefined();
			expect(deltaEOK(border, background ?? border)).toBeGreaterThan(OKLAB_JND);
		});
	}
});

test.describe('apps/docs reader sidebar (C15-2)', () => {
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
});

test.describe('apps/docs reader routes and reflow (C15-2)', () => {
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

	test('every reader page fits 320 to 1280 px without sideways scrolling (boundary)', async ({
		page,
	}) => {
		test.setTimeout(PAGE_WALK_TIMEOUT_MS);
		const slugs = await readerSlugs(page);
		const failures: string[] = [];
		for (const slug of slugs.slice(0, MAX_READER_PAGES)) {
			failures.push(...(await reflowFailures(page, slug)));
		}
		expect(failures).toEqual([]);
	});
});
