/**
 * Property-based fuzzing of the markdown sanitiser: whatever markdown and raw
 * HTML goes in, the output holds only allowlisted tags, attributes and URIs.
 */

import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
	ALLOWED_ATTR,
	ALLOWED_TAGS,
	ALLOWED_URI_REGEXP,
	renderMarkdown,
} from '../src/markdown/sanitize.js';

const FRAGMENTS = [
	'<script>alert(1)</script>',
	'<img src=x onerror=alert(1)>',
	'<a href="javascript:alert(1)">x</a>',
	'<a href="JaVaScRiPt:alert(1)">x</a>',
	'<a href="https://example.com">ext</a>',
	'<svg onload=alert(1)><circle/></svg>',
	'<iframe src="https://example.com"></iframe>',
	'<div style="background:url(javascript:alert(1))">s</div>',
	'<img src="data:image/svg+xml;base64,PHN2Zz4=">',
	'<img src="data:image/png;base64,iVBORw0KGgo=">',
	'<math><mi xlink:href="javascript:alert(1)">m</mi></math>',
	'<form action="javascript:alert(1)"><input></form>',
	'[link](javascript:alert(1))',
	'![img](data:text/html,<script>alert(1)</script>)',
	'<p title="x" onclick="alert(1)">p</p>',
	'**bold** _em_ `code`',
	'\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n',
	'\n```\n<script>x</script>\n```\n',
	'<',
	'>',
	'"',
	"'",
	'&#x6A;avascript:',
];

const markdown = fc
	.array(fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ maxLength: 40 })), { maxLength: 12 })
	.map((parts) => parts.join(''));

const URI_ATTRS = new Set(['href', 'src', 'xlink:href']);
const allowedTags = new Set(ALLOWED_TAGS);
const allowedAttrs = new Set(ALLOWED_ATTR);

/** Lists every tag, attribute or URI in `html` the allowlist does not admit. */
function violations(html: string): string[] {
	const body = new JSDOM(`<body>${html}</body>`).window.document.body;
	const found: string[] = [];
	for (const el of body.querySelectorAll('*')) {
		const tag = el.tagName.toLowerCase();
		if (!allowedTags.has(tag)) found.push(`tag ${tag}`);
		for (const attr of el.attributes) {
			if (!allowedAttrs.has(attr.name)) found.push(`attr ${tag}[${attr.name}]`);
			if (URI_ATTRS.has(attr.name) && !ALLOWED_URI_REGEXP.test(attr.value)) {
				found.push(`uri ${tag}[${attr.name}]=${attr.value}`);
			}
		}
	}
	return found;
}

describe('renderMarkdown — property fuzzing', () => {
	it('emits only allowlisted tags, attributes and URIs', () => {
		fc.assert(
			fc.property(markdown, (source) => {
				expect(violations(renderMarkdown(source))).toEqual([]);
			}),
			{ numRuns: 300 },
		);
	});

	it('keeps a second pass inside the allowlist', () => {
		fc.assert(
			fc.property(markdown, (source) => {
				expect(violations(renderMarkdown(renderMarkdown(source)))).toEqual([]);
			}),
			{ numRuns: 100 },
		);
	});
});
