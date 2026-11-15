import type { Locator } from '@playwright/test';

/**
 * Whether reader text is drawn where a reader can see it, for `reader.spec.ts` (gap audit C15-2).
 * Every function named `...InPage` runs inside the page through `evaluate`, so it reads only its
 * arguments and browser globals.
 */

/** Layout boxes land on fractional pixels; allow half a pixel of rounding. */
export const SUBPIXEL = 0.5;
/** Ancestors walked for clipping boxes and backgrounds (HISS-02); reader `<code>` sits seven levels below `<html>`. */
export const MAX_ANCESTOR_DEPTH = 32;
/** Boxes checked per element (HISS-02); the longest code block on CODE_SLUG has 553 today. */
const MAX_FRAGMENTS = 5_000;
/** Elements checked for clipping per page (HISS-02); the largest article holds 3,106 today. */
export const MAX_PROSE_ELEMENTS = 20_000;
/** Text nodes hit-tested per element (HISS-02); well above the text nodes of the largest article. */
const MAX_TEXT_NODES = 20_000;
/** Makes every box and pseudo-element a hit target, so an overlay with `pointer-events: none` still covers. */
const HIT_EVERY_BOX = '*, *::before, *::after { pointer-events: auto !important; }';
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
		const boxes = [...element.getClientRects()].map(onPage).filter(solid);
		if (boxes.length > maxFragments) return `more than ${maxFragments} boxes`;
		const parts = boxes.map((box) => meet(box, clip)).filter(solid);
		return parts.length === 0 ? 'no part inside the viewport' : parts;
	};
	return elements.map(failure);
}

/** What `textCoveredInPage` reads besides the elements. */
interface TextInput {
	parts: (string | Box[])[];
	css: string;
	maxNodes: number;
	subpixel: number;
	scrollers: readonly string[];
}

/**
 * Runs in the page: why the text under each element is not what a reader sees where it is laid
 * out, as reasons per element. Every text node under the element that holds more than white space,
 * up to `maxNodes`, must be visible itself: its parent passes `checkVisibility`, which also reads
 * the visibility and opacity of every ancestor (CSSOM View §6), so a hidden `<span>` inside a
 * visible block fails. The text must have a line box (`Range.getClientRects`) wider than
 * `subpixel`, so text shrunk to nothing (`font-size: 0`, `transform: scale(0)`) fails, and each
 * of its line boxes must reach a visible part of the element, so a line moved off it
 * (`text-indent`, a relative offset) fails; only a line inside one of `scrollers` may lie outside,
 * since the reader can scroll to it. Each line box inside a visible part is then hit-tested at
 * its centre with `caretPositionFromPoint` (CSSOM View §6.1), which must land in that same text
 * node: an overlay, a later sibling or any other box drawn over the text takes the hit instead.
 * An extra style sheet makes every box a hit target while it runs, so an overlay that sets
 * `pointer-events: none` still counts on an engine whose caret hit test honours it, and the page
 * gets its own sheets back afterwards. The check scrolls only vertically, so page coordinates
 * stay valid.
 */
function textCoveredInPage(elements: Element[], input: TextInput): string[][] {
	const solidPart = (box: Box): boolean =>
		box.right - box.left > input.subpixel && box.bottom > box.top;
	const lineCentres = (node: Text, parts: Box[]): { x: number; y: number }[][] => {
		const range = document.createRange();
		range.selectNodeContents(node);
		const rects = [...range.getClientRects()].filter(solidPart);
		return rects.map((rect) =>
			parts.flatMap((part) => {
				const cut = {
					left: Math.max(rect.left, part.left),
					right: Math.min(rect.right, part.right),
					top: Math.max(rect.top + window.scrollY, part.top),
					bottom: Math.min(rect.bottom + window.scrollY, part.bottom),
				};
				if (!solidPart(cut)) return [];
				return [{ x: (cut.left + cut.right) / 2, y: (cut.top + cut.bottom) / 2 }];
			}),
		);
	};
	const scroller = input.scrollers.join(', ');
	const caretOn = (node: Text, point: { x: number; y: number }): boolean => {
		window.scrollTo({ top: point.y - window.innerHeight / 2, behavior: 'instant' });
		return document.caretPositionFromPoint(point.x, point.y - window.scrollY)?.offsetNode === node;
	};
	const label = (node: Text): string => JSON.stringify(node.data.trim().slice(0, 24));
	const textReasons = (node: Text, parts: Box[]): string[] => {
		const parent = node.parentElement;
		if (parent?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) !== true)
			return [`text ${label(node)} hidden`];
		const lines = lineCentres(node, parts);
		if (lines.length === 0) return [`text ${label(node)} has no size`];
		if (lines.some((points) => points.length === 0) && parent.closest(scroller) === null)
			return [`text ${label(node)} outside the visible element`];
		const covered = lines.flat().some((point) => !caretOn(node, point));
		return covered ? [`text ${label(node)} covered`] : [];
	};
	const elementReasons = (element: Element, parts: string | Box[] | undefined): string[] => {
		if (!Array.isArray(parts)) return [];
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const reasons: string[] = [];
		let count = 0;
		for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
			if (!(node instanceof Text) || node.data.trim() === '') continue;
			count += 1;
			if (count > input.maxNodes) return [`more than ${input.maxNodes} text nodes`];
			reasons.push(...textReasons(node, parts));
		}
		return reasons;
	};
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(input.css);
	const own = document.adoptedStyleSheets;
	document.adoptedStyleSheets = [...own, sheet];
	try {
		return elements.map((element, index) => elementReasons(element, input.parts.at(index)));
	} finally {
		document.adoptedStyleSheets = own;
	}
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
	const covered = await locator.evaluateAll(textCoveredInPage, {
		parts,
		css: HIT_EVERY_BOX,
		maxNodes: MAX_TEXT_NODES,
		subpixel: SUBPIXEL,
		scrollers: SIDEWAYS_SCROLLERS,
	});
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
	const viewport = fromBody ? getComputedStyle(document.body) : rootStyle;
	const scrollport =
		(cuts(viewport.overflowX) && root.scrollWidth > root.clientWidth) ||
		(cuts(viewport.overflowY) && root.scrollHeight > root.clientHeight);
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
	return [...(scrollport ? ['the viewport clips the page'] : []), ...clipped, ...painted];
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
