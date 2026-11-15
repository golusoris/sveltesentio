import type { Locator } from '@playwright/test';

/**
 * Whether reader text is drawn where a reader can see it, for `reader.spec.ts` (gap audit C15-2).
 * Every function named `...InPage` runs inside the page through `evaluate`, so it reads only its
 * arguments and browser globals.
 *
 * Scope: these checks prove reflow (WCAG 2.2 SC 1.4.10), that text is drawn, inside the screen
 * width or a code block's or table's scroll area, and not covered. They do not prove legibility:
 * low contrast, overlapping glyphs and CSS written to defeat these checks pass them; issue #591
 * tracks those checks.
 */

/** Layout boxes land on fractional pixels; allow half a pixel of rounding. */
export const SUBPIXEL = 0.5;
/**
 * Ancestors walked for clipping boxes and pseudo-elements, and scrolling boxes walked around a line
 * (HISS-02); reader `<code>` sits seven levels below `<html>`.
 */
export const MAX_ANCESTOR_DEPTH = 32;
/** Boxes checked per element (HISS-02); the longest code block on CODE_SLUG has 553 today. */
const MAX_FRAGMENTS = 5_000;
/** Elements checked for clipping per page (HISS-02); the largest article holds 3,106 today. */
export const MAX_PROSE_ELEMENTS = 20_000;
/** Text nodes walked per element, white space included (HISS-02); the largest article holds 4,512 today. */
const MAX_TEXT_NODES = 20_000;
/** Makes every box and pseudo-element a hit target, so an overlay with `pointer-events: none` still covers. */
const HIT_EVERY_BOX = '*, *::before, *::after { pointer-events: auto !important; }';
/** The `Symbol.for` key the hit-target sheet sits under on `document` while `textCoveredInPage` runs. */
const HIT_SHEET_KEY = '@sveltesentio/docs/e2e/hit-every-box';
/** Paint properties that can hide a reader box while its layout, visibility and opacity stay unchanged. */
const PLAIN_PAINT = ['clip-path', 'mask-image', 'filter'] as const;
/** The boxes reader styles let scroll sideways (`pre` and `table` in apps/docs/src/app.css); prose must wrap. */
const SIDEWAYS_SCROLLERS = ['PRE', 'TABLE'] as const;

interface DrawnLimits {
	subpixel: number;
	maxFragments: number;
	maxDepth: number;
	/** Whether the whole border box must sit inside the viewport width, as every block must. */
	whole: boolean;
}

/** A box in page coordinates. */
interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * Runs in the page: why each element is not drawn, or the parts of its boxes a reader can see. It
 * must not be hidden or transparent (`checkVisibility` also reads the opacity of every ancestor,
 * CSSOM View §6). Each of its boxes (one for a block, one or more per line for inline `<code>`) is
 * cut to the viewport's client width, which leaves out a vertical scrollbar, and to the padding box
 * of every ancestor that clips or scrolls, on each axis whose overflow is not visible. `<body>`
 * counts unless it passes its overflow to the viewport (CSS Overflow 3 §3.3), which
 * `clippedInPage` checks. At least one part must remain. A box scrolled out of its code block is
 * reachable, not hidden, so it is skipped. Boxes are kept in page coordinates.
 */
function partsInPage(elements: Element[], limits: DrawnLimits): (string | Box[])[] {
	const { subpixel, maxFragments, maxDepth, whole } = limits;
	const far = Number.POSITIVE_INFINITY;
	const root = document.documentElement;
	const width = root.clientWidth;
	const rootStyle = getComputedStyle(root);
	const visibleRoot = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
	const stop = visibleRoot ? document.body : root;
	const solid = (box: Box): boolean => box.right - box.left > subpixel && box.bottom > box.top;
	const meet = (one: Box, two: Box): Box => ({
		left: Math.max(one.left, two.left),
		right: Math.min(one.right, two.right),
		top: Math.max(one.top, two.top),
		bottom: Math.min(one.bottom, two.bottom),
	});
	const onPage = (rect: DOMRect): Box => {
		const { left, right } = rect;
		return { left, right, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
	};
	const clipOf = (node: Element): Box => {
		const style = getComputedStyle(node);
		const box = onPage(node.getBoundingClientRect());
		const left = box.left + node.clientLeft;
		const top = box.top + node.clientTop;
		const across =
			style.overflowX === 'visible'
				? { left: -far, right: far }
				: { left, right: left + node.clientWidth };
		const down =
			style.overflowY === 'visible'
				? { top: -far, bottom: far }
				: { top, bottom: top + node.clientHeight };
		return { ...across, ...down };
	};
	const clipBox = (element: Element): Box | null => {
		let box: Box = { left: 0, right: width, top: -far, bottom: far };
		let node = element.parentElement;
		for (let depth = 0; node !== null && node !== stop && depth < maxDepth; depth += 1) {
			box = meet(box, clipOf(node));
			node = node.parentElement;
		}
		return node === null || node === stop ? box : null;
	};
	const failure = (element: Element): string | Box[] => {
		if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
			return 'hidden';
		const rect = element.getBoundingClientRect();
		const edges = rect.left >= -subpixel && rect.right <= width + subpixel;
		if (whole && !edges) return 'outside the viewport width';
		const clip = clipBox(element);
		if (clip === null) return `more than ${maxDepth} ancestors`;
		const rects = element.getClientRects();
		if (rects.length > maxFragments) return `more than ${maxFragments} boxes`;
		const parts = Array.from(rects, (rect) => meet(onPage(rect), clip)).filter(solid);
		return parts.length === 0 ? 'no part inside the viewport' : parts;
	};
	return elements.map(failure);
}

/** What `textCoveredInPage` reads besides the elements. */
interface TextInput {
	parts: (string | Box[])[];
	/** The test `scrollReachInPage` returns, kept in the page. */
	reachable: (node: Text, line: Box) => boolean;
	maxNodes: number;
	maxFragments: number;
	subpixel: number;
}

/** What `scrollReachInPage` reads. */
interface ReachLimits {
	subpixel: number;
	maxDepth: number;
	scrollers: readonly string[];
}

/**
 * Runs in the page: returns a test, kept in the page for `textCoveredInPage`, of whether a line box
 * outside its element's visible parts can be scrolled into view. The line must lie in the scroll
 * area of the nearest of `scrollers` around its text: the scrollable overflow, which starts at the
 * padding box's left edge, or at its right edge in a right-to-left box (where `scrollLeft` is 0 or
 * negative), and moves with the scroll position. Overflow past the top or start edge is not in that
 * area, since it cannot be scrolled to. On an axis where a scroller does not scroll (`overflow`
 * other than `auto` or `scroll`), its scroll area is its padding box. Scrolling a box never moves
 * the box itself, so its padding box must lie in the scroll area of the next scroller around it in
 * turn, and the outermost one's padding box inside the viewport's client width and below the top
 * of the page. Text with no scroller around it, or inside more than `maxDepth` nested ones, is out
 * of reach. Only a horizontal writing mode is read. Boxes are in page coordinates.
 */
function scrollReachInPage(limits: ReachLimits): (node: Text, line: Box) => boolean {
	const { subpixel, maxDepth } = limits;
	const selector = limits.scrollers.join(', ');
	const width = document.documentElement.clientWidth;
	const screen: Box = { left: 0, right: width, top: 0, bottom: Number.POSITIVE_INFINITY };
	const inside = (inner: Box, outer: Box): boolean =>
		inner.left >= outer.left - subpixel &&
		inner.right <= outer.right + subpixel &&
		inner.top >= outer.top - subpixel &&
		inner.bottom <= outer.bottom + subpixel;
	const padding = (box: Element): Box => {
		const outer = box.getBoundingClientRect();
		const left = outer.left + box.clientLeft;
		const top = outer.top + window.scrollY + box.clientTop;
		return { left, right: left + box.clientWidth, top, bottom: top + box.clientHeight };
	};
	const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';
	const area = (box: Element): Box => {
		const [edge, style] = [padding(box), getComputedStyle(box)];
		const start = style.direction === 'rtl' ? edge.right - box.scrollWidth : edge.left;
		const [left, top] = [start - box.scrollLeft, edge.top - box.scrollTop];
		const across = scrolls(style.overflowX) ? { left, right: left + box.scrollWidth } : edge;
		const down = scrolls(style.overflowY) ? { top, bottom: top + box.scrollHeight } : edge;
		return { left: across.left, right: across.right, top: down.top, bottom: down.bottom };
	};
	const around = (node: Node): Element | null => node.parentElement?.closest(selector) ?? null;
	return (node: Text, line: Box): boolean => {
		let [inner, box] = [line, around(node)];
		if (box === null) return false;
		for (let depth = 0; box !== null && depth < maxDepth; depth += 1) {
			if (!inside(inner, area(box))) return false;
			[inner, box] = [padding(box), around(box)];
		}
		return box === null && inside(inner, screen);
	};
}

/** Runs in the page: adds `css` as one more adopted style sheet, kept on `document` under `key`. */
function addSheetInPage(input: { css: string; key: string }): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(input.css);
	Reflect.set(document, Symbol.for(input.key), sheet);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/** Runs in the page: removes the sheet `addSheetInPage` kept under `key` and leaves every other one. */
function dropSheetInPage(key: string): void {
	const sheet: unknown = Reflect.get(document, Symbol.for(key));
	Reflect.deleteProperty(document, Symbol.for(key));
	document.adoptedStyleSheets = document.adoptedStyleSheets.filter((own) => own !== sheet);
}

/**
 * Runs in the page: why the text under each element is not what a reader sees where it is laid
 * out, as reasons per element. The walk visits at most `maxNodes` text nodes, white space
 * included (HISS-02). Every one that holds more than white space and format characters
 * (`\p{Cf}`, such as a soft hyphen, which draw nothing) must be visible itself: its parent passes
 * `checkVisibility`, which also reads the visibility and opacity of every ancestor (CSSOM View
 * §6), so a hidden `<span>` inside a visible block fails. The text must have a line box
 * (`Range.getClientRects`, at most `maxFragments`) wider and taller than `subpixel`, so text
 * shrunk to nothing (`font-size: 0`, `transform: scale(0)` or `scaleY(0.001)`) fails, and each of
 * its line boxes must reach a visible part of the element, so a line moved off it (`text-indent`,
 * a relative offset) fails. A line that reaches none may still pass when `reachable` finds it in
 * a scroll area the reader can scroll to (see `scrollReachInPage`). Each line box is then
 * hit-tested at the centre of every overlap with a visible part that is wider and taller than
 * `subpixel`, or, when it has none, of every overlap however thin, so a line scrolled almost out
 * of its box is still tested where it shows. The hit test is `caretPositionFromPoint` (CSSOM View
 * §6.1), which must land in that same text node: an overlay, a later sibling or any other box
 * drawn over the text takes the hit instead. `textCovered` adds a style sheet that makes every
 * box a hit target while this runs, so an overlay that sets `pointer-events: none` still counts
 * on an engine whose caret hit test honours it. The check scrolls only vertically and reads every
 * line box in page coordinates.
 */
function textCoveredInPage(elements: Element[], input: TextInput): string[][] {
	const { subpixel, maxFragments, reachable } = input;
	const seen = { visibilityProperty: true, opacityProperty: true };
	const solid = (box: Box): boolean =>
		box.right - box.left > subpixel && box.bottom - box.top > subpixel;
	const lineBoxes = (node: Text): Box[] | null => {
		const range = document.createRange();
		range.selectNodeContents(node);
		const rects = range.getClientRects();
		if (rects.length > maxFragments) return null;
		const down = window.scrollY;
		const page = Array.from(rects, (r) => new DOMRect(r.x, r.y + down, r.width, r.height));
		return page.filter(solid);
	};
	const overlaps = (line: Box, parts: Box[], least: number): DOMPoint[] =>
		parts.flatMap((part) => {
			const [left, right] = [Math.max(line.left, part.left), Math.min(line.right, part.right)];
			const [top, bottom] = [Math.max(line.top, part.top), Math.min(line.bottom, part.bottom)];
			const cut = new DOMPoint((left + right) / 2, (top + bottom) / 2);
			return right - left > least && bottom - top > least ? [cut] : [];
		});
	const centres = (line: Box, parts: Box[]): DOMPoint[] => {
		const wide = overlaps(line, parts, subpixel);
		return wide.length > 0 ? wide : overlaps(line, parts, 0);
	};
	const caretOn = (node: Text, point: DOMPoint): boolean => {
		window.scrollTo({ top: point.y - window.innerHeight / 2, behavior: 'instant' });
		return document.caretPositionFromPoint(point.x, point.y - window.scrollY)?.offsetNode === node;
	};
	const textReasons = (node: Text, parts: Box[]): string[] => {
		const text = `text ${JSON.stringify(node.data.trim().slice(0, 24))}`;
		if (node.parentElement?.checkVisibility(seen) !== true) return [`${text} hidden`];
		const lines = lineBoxes(node);
		if (lines === null) return [`${text} has more than ${maxFragments} boxes`];
		if (lines.length === 0) return [`${text} has no size`];
		const cuts = lines.map((line) => ({ line, points: centres(line, parts) }));
		if (cuts.some(({ line, points }) => points.length === 0 && !reachable(node, line)))
			return [`${text} outside the visible element`];
		const covered = cuts.some(({ points }) => points.some((point) => !caretOn(node, point)));
		return covered ? [`${text} covered`] : [];
	};
	const elementReasons = (element: Element, parts: string | Box[] | undefined): string[] => {
		if (!Array.isArray(parts)) return [];
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const reasons: string[] = [];
		for (let count = 0; count < input.maxNodes; count += 1) {
			const node = walker.nextNode();
			if (node === null) return reasons;
			if (node instanceof Text && !/^[\s\p{Cf}]*$/u.test(node.data))
				reasons.push(...textReasons(node, parts));
		}
		return walker.nextNode() === null ? reasons : [`more than ${input.maxNodes} text nodes`];
	};
	return elements.map((element, index) => elementReasons(element, input.parts.at(index)));
}

/**
 * Runs in the page: the `::before` and `::after` boxes in or above each element that can be drawn
 * over its text, as `<tag>::after` per element. A pseudo-element is no DOM node, so neither a caret
 * nor an element hit test ever lands on one (measured on Chromium 156: an absolutely positioned
 * `::after` filled with the page background over a heading still returns the heading's text). One
 * that generates a box (`content` other than `none` or `normal`) is rejected when it leaves the
 * flow or moves from where the flow put it: `position` other than `static`, a `transform`, or a
 * negative margin. The element itself, every element inside it and its ancestors up to `<html>`
 * are read, up to `maxElements` and `maxDepth`.
 */
function pseudoCoversInPage(
	elements: Element[],
	limits: { maxElements: number; maxDepth: number },
): string[][] {
	const sides = ['top', 'right', 'bottom', 'left'] as const;
	const moved = (style: CSSStyleDeclaration): boolean =>
		style.position !== 'static' ||
		style.transform !== 'none' ||
		sides.some((side) => Number.parseFloat(style.getPropertyValue(`margin-${side}`)) < 0);
	const covers = (box: Element): string[] =>
		(['::before', '::after'] as const).flatMap((pseudo) => {
			const style = getComputedStyle(box, pseudo);
			const generated = style.content !== 'none' && style.content !== 'normal';
			return generated && moved(style) ? [`<${box.tagName.toLowerCase()}>${pseudo}`] : [];
		});
	return elements.map((element) => {
		const inside = element.querySelectorAll('*');
		if (inside.length > limits.maxElements) return [`more than ${limits.maxElements} elements`];
		const above: Element[] = [];
		let node = element.parentElement;
		for (let depth = 0; node !== null && depth < limits.maxDepth; depth += 1) {
			above.push(node);
			node = node.parentElement;
		}
		if (node !== null) return [`more than ${limits.maxDepth} ancestors`];
		return [element, ...inside, ...above].flatMap(covers);
	});
}

/**
 * `textCoveredInPage` with the hit-target sheet and the scroll test in place, both of which the
 * page drops again afterwards, even on a throw.
 */
async function textCovered(locator: Locator, parts: (string | Box[])[]): Promise<string[][]> {
	const page = locator.page();
	const reachable = await page.evaluateHandle(scrollReachInPage, {
		subpixel: SUBPIXEL,
		maxDepth: MAX_ANCESTOR_DEPTH,
		scrollers: SIDEWAYS_SCROLLERS,
	});
	try {
		await page.evaluate(addSheetInPage, { css: HIT_EVERY_BOX, key: HIT_SHEET_KEY });
		return await locator.evaluateAll(textCoveredInPage, {
			parts,
			reachable,
			maxNodes: MAX_TEXT_NODES,
			maxFragments: MAX_FRAGMENTS,
			subpixel: SUBPIXEL,
		});
	} finally {
		await page.evaluate(dropSheetInPage, HIT_SHEET_KEY);
		await reachable.dispose();
	}
}

/** Why the matched elements or their text are not drawn, as `index: reason`; matching nothing is a failure too. */
export async function undrawn(locator: Locator, whole: boolean): Promise<string[]> {
	const limits: DrawnLimits = {
		subpixel: SUBPIXEL,
		maxFragments: MAX_FRAGMENTS,
		maxDepth: MAX_ANCESTOR_DEPTH,
		whole,
	};
	const parts = await locator.evaluateAll(partsInPage, limits);
	if (parts.length === 0) return ['no element matches'];
	const covered = await textCovered(locator, parts);
	const pseudo = await locator.evaluateAll(pseudoCoversInPage, {
		maxElements: MAX_PROSE_ELEMENTS,
		maxDepth: MAX_ANCESTOR_DEPTH,
	});
	return parts.flatMap((part, index) => {
		if (typeof part === 'string') return [`${index}: ${part}`];
		const over = (pseudo.at(index) ?? []).map((box) => `${box} can cover the text`);
		return [...(covered.at(index) ?? []), ...over].map((reason) => `${index}: ${reason}`);
	});
}

/**
 * Runs in the page: the boxes that cut off, hide or sideways-scroll their content. A box with
 * `overflow: hidden` or `clip` whose content is wider or taller than its padding box hides that
 * content, where `auto` or `scroll` would let the reader scroll to it. Only the boxes in
 * `scrollers` may scroll sideways: prose that does makes the reader scroll in two directions, which
 * SC 1.4.10 rules out. Checks the article, everything inside it and its ancestors, `<body>` included
 * unless it passes its overflow to the viewport (CSS Overflow 3 §3.3: the root's overflow, or the
 * body's when the root's is visible on both axes, applies to the viewport, where `clip` acts as
 * `hidden`). `<hr>` has `overflow: hidden` from the UA stylesheet but no content. Every one of
 * those boxes, `<html>` included, must also leave each paint property in `plain` at `none`.
 */
function clippedInPage(
	article: Element,
	limits: {
		maxElements: number;
		maxDepth: number;
		plain: readonly string[];
		scrollers: readonly string[];
	},
): string[] {
	const inside = article.querySelectorAll('*');
	if (inside.length > limits.maxElements) return [`more than ${limits.maxElements} elements`];
	const root = document.documentElement;
	const rootStyle = getComputedStyle(root);
	const fromBody = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
	const above: Element[] = [];
	let node = article.parentElement;
	for (let depth = 0; node !== null && depth < limits.maxDepth; depth += 1) {
		above.push(node);
		node = node.parentElement;
	}
	const stop = above.indexOf(fromBody ? document.body : root);
	const boxes = [article, ...inside];
	const clipping = [...boxes, ...above.slice(0, stop === -1 ? above.length : stop)];
	const cuts = (overflow: string): boolean => overflow === 'hidden' || overflow === 'clip';
	const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';
	const scrollport = (): boolean => {
		const viewport = fromBody ? getComputedStyle(document.body) : rootStyle;
		const wide = cuts(viewport.overflowX) && root.scrollWidth > root.clientWidth;
		return wide || (cuts(viewport.overflowY) && root.scrollHeight > root.clientHeight);
	};
	const name = (box: Element): string => `<${box.tagName.toLowerCase()}>`;
	const clipped = clipping.flatMap((box) => {
		const style = getComputedStyle(box);
		const wider = box.scrollWidth > box.clientWidth;
		const wide = cuts(style.overflowX) && wider;
		const tall = cuts(style.overflowY) && box.scrollHeight > box.clientHeight;
		const sideways = scrolls(style.overflowX) && wider && !limits.scrollers.includes(box.tagName);
		return [
			...(wide || tall ? [`${name(box)} clips its content`] : []),
			...(sideways ? [`${name(box)} scrolls its content sideways`] : []),
		];
	});
	const painted = [...boxes, ...above].flatMap((box) => {
		const style = getComputedStyle(box);
		const set = limits.plain.filter((property) => style.getPropertyValue(property) !== 'none');
		return set.map((property) => `${name(box)} sets ${property}`);
	});
	return [...(scrollport() ? ['the viewport clips the page'] : []), ...clipped, ...painted];
}

/** Why the article clips, hides, sideways-scrolls or paints over its content; see `clippedInPage`. */
export async function clipped(article: Locator, timeout: number): Promise<string[]> {
	const limits = {
		maxElements: MAX_PROSE_ELEMENTS,
		maxDepth: MAX_ANCESTOR_DEPTH,
		plain: PLAIN_PAINT,
		scrollers: SIDEWAYS_SCROLLERS,
	};
	return article.evaluate(clippedInPage, limits, { timeout });
}
