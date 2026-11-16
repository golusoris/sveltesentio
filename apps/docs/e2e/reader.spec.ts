import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test';

import { MAX_ANCESTOR_DEPTH, MAX_PROSE_ELEMENTS, SUBPIXEL, clipped, undrawn } from './drawn';

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
/** Explicit deadline for each navigation and poll (HISS-02); the local preview answers in well under 1 s. */
const NAV_TIMEOUT_MS = 15_000;
/** One just noticeable difference as an OKLab distance (deltaEOK), from CSS Color 4 §14.2.1. */
const OKLAB_JND = 0.02;
/** Glyphs per run when comparing the advance of a narrow and a wide letter. */
const GLYPH_RUN = 20;
/** Screenshot rows read down the callout border (HISS-02); the first callout on CODE_SLUG is 58 px tall today. */
const MAX_BORDER_ROWS = 2_000;
/** Rows skipped at each end of the border, where it meets the box edge on a fractional pixel. */
const EDGE_ROWS = 1;
/** A computed colour reads `oklab(L a b)` or `color(srgb r g b)`, with ` / alpha` added only below full opacity. */
const OKLAB_PREFIX = 'oklab(';
const SRGB_PREFIX = 'color(srgb ';
const ALPHA_SEPARATOR = ' / ';
/** Relative colour syntax around an authored colour; the browser resolves it to the computed form above. */
type ColourTemplate = readonly [head: string, tail: string];
const TO_OKLAB: ColourTemplate = ['oklab(from ', ' l a b / alpha)'];
const TO_SRGB: ColourTemplate = ['color(from ', ' srgb r g b / alpha)'];

/** Every auto-retrying assertion waits at most one navigation deadline instead of the 5 s default (HISS-02). */
const expect = baseExpect.configure({ timeout: NAV_TIMEOUT_MS });

interface Colour {
	channels: number[];
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
		{ timeout: NAV_TIMEOUT_MS },
	);
}

async function boxOf(locator: Locator): Promise<{ x: number; width: number }> {
	const box = await locator.boundingBox({ timeout: NAV_TIMEOUT_MS });
	expect(box, 'element has a layout box').not.toBeNull();
	return box ?? { x: Number.NaN, width: Number.NaN };
}

/** Splits the string instead of matching a regular expression, so no input can backtrack. */
function parseChannels(css: string, prefix: string): Colour {
	const wrapped = css.startsWith(prefix) && css.endsWith(')');
	const inner = wrapped ? css.slice(prefix.length, -1) : '';
	const [channels = '', alpha = '1', ...extra] = inner.split(ALPHA_SEPARATOR);
	const parts = [...channels.split(' '), alpha];
	const values = parts.map((part) => (part === '' ? Number.NaN : Number(part)));
	const valid = extra.length === 0 && parts.length === 4 && values.every(Number.isFinite);
	expect(valid, `${css} is a computed ${prefix}) colour`).toBe(true);
	return { channels: values.slice(0, 3), alpha: values[3] ?? 0 };
}

function deltaEOK(one: Colour, two: Colour): number {
	return Math.hypot(
		...one.channels.map((value, index) => value - (two.channels.at(index) ?? value)),
	);
}

/** Source over an opaque backdrop, per sRGB channel: Co = αs × Cs + (1 − αs) × Cb. */
function over(backdrop: Colour, source: Colour): Colour {
	const channels = backdrop.channels.map(
		(under, index) =>
			source.alpha * (source.channels.at(index) ?? under) + (1 - source.alpha) * under,
	);
	return { channels, alpha: 1 };
}

/**
 * The colour behind a stack of backgrounds listed innermost first: each translucent layer composited
 * over the first opaque one, the simple alpha compositing of Compositing and Blending Level 1 §5.1
 * with an opaque backdrop. Undefined when no layer is opaque.
 */
function composite(layers: Colour[]): Colour | undefined {
	const base = layers.find((layer) => layer.alpha === 1);
	if (base === undefined) return undefined;
	return layers
		.slice(0, layers.indexOf(base))
		.reduceRight((under, layer) => over(under, layer), base);
}

/** Runs in the page: resolves each colour through the template on an unstyled probe, which always leaves again. */
function convertInPage(input: { colours: string[]; template: ColourTemplate }): string[] {
	const [head, tail] = input.template;
	const probe = document.createElement('span');
	document.body.append(probe);
	try {
		return input.colours.map((colour) => {
			// Cleared first: an unparsable colour then reads as the inherited text colour, which no parse accepts.
			probe.style.color = '';
			probe.style.color = `${head}${colour}${tail}`;
			return getComputedStyle(probe).color;
		});
	} finally {
		probe.remove();
	}
}

async function convert(page: Page, colours: string[], template: ColourTemplate): Promise<string[]> {
	return page.evaluate(convertInPage, { colours, template });
}

/**
 * The callout's left border colour and the backdrop its outer edge meets, both in OKLab. The
 * border meets the page, not the callout's own fill, so the backdrop composites the backgrounds of
 * its ancestors from its parent outwards. The browser converts every colour, so any authored form
 * compares.
 */
async function calloutColours(
	page: Page,
	callout: Locator,
): Promise<{ border: Colour; backdrop: Colour | undefined }> {
	const authored = await callout.evaluate(
		(element, maxDepth) => {
			const backgrounds: string[] = [];
			let node: Element | null = element.parentElement;
			for (let depth = 0; node !== null && depth < maxDepth; depth += 1) {
				backgrounds.push(getComputedStyle(node).backgroundColor);
				node = node.parentElement;
			}
			return { border: getComputedStyle(element).borderLeftColor, backgrounds };
		},
		MAX_ANCESTOR_DEPTH,
		{ timeout: NAV_TIMEOUT_MS },
	);
	const layers = await convert(page, authored.backgrounds, TO_SRGB);
	const backdrop = composite(layers.map((css) => parseChannels(css, SRGB_PREFIX)));
	const behind = backdrop === undefined ? [] : [`color(srgb ${backdrop.channels.join(' ')})`];
	const converted = await convert(page, [authored.border, ...behind], TO_OKLAB);
	const backdropOklab = converted.at(1);
	return {
		border: parseChannels(converted.at(0) ?? '', OKLAB_PREFIX),
		backdrop: backdropOklab === undefined ? undefined : parseChannels(backdropOklab, OKLAB_PREFIX),
	};
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
 * Runs in the page: the distinct `color` and `-webkit-text-fill-color` of every element under the
 * roots, roots included, that holds text of its own, and how many elements it read. Nothing is read
 * past `maxElements`.
 */
function textColoursInPage(
	roots: Element[],
	maxElements: number,
): { count: number; colours: string[] } {
	const elements = roots.flatMap((root) => [root, ...root.querySelectorAll('*')]);
	if (elements.length > maxElements) return { count: elements.length, colours: [] };
	const ownText = (element: Element): boolean =>
		[...element.childNodes].some(
			(child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '',
		);
	const colours = elements.filter(ownText).flatMap((element) => {
		const style = getComputedStyle(element);
		return [style.color, style.getPropertyValue('-webkit-text-fill-color')];
	});
	return { count: elements.length, colours: [...new Set(colours)] };
}

/**
 * The fully transparent text colours under the matched elements. Text drawn in one keeps its layout
 * and its hit target, so neither `checkVisibility` nor a hit test sees that nothing is painted.
 */
async function transparentText(page: Page, locator: Locator): Promise<string[]> {
	const { count, colours } = await locator.evaluateAll(textColoursInPage, MAX_PROSE_ELEMENTS);
	if (count === 0) return ['no element matches'];
	if (count > MAX_PROSE_ELEMENTS) return [`more than ${MAX_PROSE_ELEMENTS} elements`];
	const resolved = await convert(page, colours, TO_SRGB);
	return colours.flatMap((colour, index) =>
		parseChannels(resolved.at(index) ?? '', SRGB_PREFIX).alpha === 0
			? [`text drawn in ${colour}`]
			: [],
	);
}

/**
 * Runs in the page: decodes a PNG screenshot of the callout and reads the colour of every pixel in
 * the column down the middle of its left border, leaving out `skip` rows at each end. A string is
 * the reason no column was read; the decode gets `deadline` milliseconds (HISS-02).
 */
async function borderColumnInPage(input: {
	png: string;
	border: number;
	width: number;
	skip: number;
	maxRows: number;
	deadline: number;
}): Promise<string | string[]> {
	const bytes = Uint8Array.from(atob(input.png), (char) => char.charCodeAt(0));
	const decode = createImageBitmap(new Blob([bytes], { type: 'image/png' }));
	const late = new Promise<null>((resolve) => {
		setTimeout(() => {
			resolve(null);
		}, input.deadline);
	});
	const bitmap = await Promise.race([decode, late]);
	if (bitmap === null) return `no decode within ${input.deadline} ms`;
	const rows = bitmap.height - 2 * input.skip;
	if (rows < 1 || rows > input.maxRows) return `${rows} rows, outside 1 to ${input.maxRows}`;
	const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
	if (context === null) return 'no 2D canvas';
	context.drawImage(bitmap, 0, 0);
	const x = Math.floor((input.border / 2) * (bitmap.width / input.width));
	const data = context.getImageData(x, input.skip, 1, rows).data;
	return Array.from({ length: rows }, (_, row) => {
		const pixel = Array.from(data.subarray(row * 4, row * 4 + 3));
		return `rgb(${pixel.join(' ')})`;
	});
}

/**
 * The distinct colours drawn down the callout's left border, in OKLab, or why none were read. A
 * screenshot shows what the reader sees, so a clip path, mask or overlay that hides the border
 * shows here even though its computed style is unchanged.
 */
async function drawnBorder(page: Page, callout: Locator): Promise<string | Colour[]> {
	const png = await callout.screenshot({ animations: 'disabled', timeout: NAV_TIMEOUT_MS });
	const column = await page.evaluate(borderColumnInPage, {
		png: png.toString('base64'),
		border: Number.parseFloat(await styleOf(callout, 'border-left-width')),
		width: (await boxOf(callout)).width,
		skip: EDGE_ROWS,
		maxRows: MAX_BORDER_ROWS,
		deadline: NAV_TIMEOUT_MS,
	});
	if (typeof column === 'string') return column;
	const unique = [...new Set(column)];
	const converted = await convert(page, unique, TO_OKLAB);
	return converted.map((css) => parseChannels(css, OKLAB_PREFIX));
}

/** Loads one reader page once, then lists each width where it scrolls sideways, clips or hides its text. */
async function reflowFailures(page: Page, slug: string): Promise<string[]> {
	await openDoc(page, slug);
	const article = page.locator('article.prose');
	const blocks = article.locator(':scope > *').filter({ hasText: /\S/ });
	const failures: string[] = [];
	for (const width of REFLOW_WIDTHS) {
		await page.setViewportSize({ width, height: VIEW_HEIGHT });
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		const problems = [
			...(overflow > 0 ? [`${overflow} px wider`] : []),
			...(await clipped(article, NAV_TIMEOUT_MS)),
			...(await transparentText(page, article)),
			...(await undrawn(article, true)).map((reason) => `article ${reason}`),
			...(await undrawn(article.locator('h1').first(), true)).map((reason) => `heading ${reason}`),
			...(await undrawn(blocks, false)).map((reason) => `block ${reason}`),
		];
		failures.push(...problems.map((problem) => `/docs/${slug} at ${width} px: ${problem}`));
	}
	return failures;
}

test.describe('apps/docs reader code blocks (C15-2)', () => {
	test('code blocks render as scrollable monospace text (positive)', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await openDoc(page, CODE_SLUG);

		const blocks = page.locator('article.prose pre');
		const codes = page.locator('article.prose pre > code');
		const total = await blocks.count();
		expect(total).toBeGreaterThanOrEqual(1);
		await expect(codes).toHaveCount(total);

		expect(await undrawn(blocks, true), 'every code block is drawn').toEqual([]);
		// A drawn <pre> does not prove its <code> is: check every line of the code itself.
		expect(await undrawn(codes, false), 'the code in every block is drawn').toEqual([]);
		expect(await transparentText(page, codes), 'the code text has a colour').toEqual([]);
		// The UA stylesheet already gives <code> a bare `monospace`; assert the docs stack on
		// every block, so a rule that only reaches a later block still fails. Canvas text uses
		// the page's font matching, so equal advances for a run of `i` and a run of `M` mean
		// the family that actually draws the code is monospace, whatever the stack lists first.
		const styles = await blocks.evaluateAll(
			(nodes, { run, subpixel }) =>
				nodes.map((node) => {
					const code = getComputedStyle(node.querySelector('code') ?? node);
					const context = new OffscreenCanvas(1, 1).getContext('2d');
					if (context !== null) context.font = `${code.fontSize} ${code.fontFamily}`;
					const advance = (glyph: string): number =>
						context?.measureText(glyph.repeat(run)).width ?? Number.NaN;
					return {
						font: code.fontFamily,
						monospaced: Math.abs(advance('i') - advance('M')) <= subpixel,
						overflowX: getComputedStyle(node).overflowX,
					};
				}),
			{ run: GLYPH_RUN, subpixel: SUBPIXEL },
		);
		expect(styles.filter((style) => !style.font.includes('ui-monospace'))).toEqual([]);
		expect(
			styles.filter((style) => !style.monospaced),
			'every block draws monospace',
		).toEqual([]);
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
		expect(await undrawn(pre, true), 'every code block is drawn inside 320 px').toEqual([]);
		expect(await undrawn(pre.locator('> code'), false), 'the code in every block is drawn').toEqual(
			[],
		);
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

			const callout = page.locator('article.prose blockquote').first();
			const { border, backdrop } = await calloutColours(page, callout);
			// A transparent or translucent border would show the background instead of its own colour.
			expect(border.alpha, 'border colour is opaque').toBe(1);
			expect(backdrop, 'an opaque background sits behind the callout').toBeDefined();
			expect(deltaEOK(border, backdrop ?? border)).toBeGreaterThan(OKLAB_JND);
			// The computed colour proves nothing if the border is not painted: read the screenshot.
			const drawn = await drawnBorder(page, callout);
			expect(typeof drawn === 'string' ? drawn : '', 'the border column is read').toBe('');
			const pixels = typeof drawn === 'string' ? [] : drawn;
			expect(pixels.length, 'the border has rows').toBeGreaterThan(0);
			expect(
				pixels.filter((pixel) => deltaEOK(pixel, border) > OKLAB_JND),
				'every row of the border draws its colour',
			).toEqual([]);
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
		const firstTitle = (await heading.textContent({ timeout: NAV_TIMEOUT_MS })) ?? '';
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

		const aside = await page.locator('aside.sidebar').evaluate(
			(element) => {
				const rect = element.getBoundingClientRect();
				return { top: rect.top, height: rect.height, right: rect.right };
			},
			undefined,
			{ timeout: NAV_TIMEOUT_MS },
		);
		const mainLeft = await page
			.locator('main#main')
			.evaluate((element) => element.getBoundingClientRect().left, undefined, {
				timeout: NAV_TIMEOUT_MS,
			});
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
