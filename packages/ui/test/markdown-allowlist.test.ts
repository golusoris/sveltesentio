import { describe, expect, it } from 'vitest';
import { ALLOWED_ATTR, renderMarkdown } from '../src/markdown/index.js';

const EXPECTED_ATTRS = [
	'href',
	'title',
	'src',
	'alt',
	'rel',
	'target',
	'class',
	'align',
	'width',
	'height',
	'loading',
] as const;

describe('ALLOWED_ATTR allowlist', () => {
	it('matches the exact hardened attribute allowlist in order', () => {
		expect(ALLOWED_ATTR).toEqual(EXPECTED_ATTRS);
	});

	it('contains exactly 11 permitted attributes', () => {
		expect(ALLOWED_ATTR).toHaveLength(11);
	});

	it('contains no style attribute to prevent CSS-injection attacks', () => {
		expect(ALLOWED_ATTR).not.toContain('style');
		expect(ALLOWED_ATTR.includes('style')).toBe(false);
	});

	it('contains no srcdoc attribute to prevent nested frame injection', () => {
		expect(ALLOWED_ATTR).not.toContain('srcdoc');
		expect(ALLOWED_ATTR.includes('srcdoc')).toBe(false);
	});

	it('contains zero on* event handler attributes', () => {
		const dangerousHandlers = [
			'onclick',
			'onerror',
			'onload',
			'onmouseover',
			'onfocus',
			'onblur',
			'onchange',
			'onsubmit',
			'onkeydown',
			'onanimationstart',
		];
		for (const handler of dangerousHandlers) {
			expect(ALLOWED_ATTR).not.toContain(handler);
		}
		for (const attr of ALLOWED_ATTR) {
			expect(attr).not.toMatch(/^on/i);
		}
	});

	it('excludes dangerous DOM clobbering identifiers and sink attributes', () => {
		const clobberingAttrs = ['id', 'name', 'formaction', 'action', 'xlink:href'];
		for (const attr of clobberingAttrs) {
			expect(ALLOWED_ATTR).not.toContain(attr);
		}
	});
});

describe('renderMarkdown sanitisation with ALLOWED_ATTR boundary', () => {
	it('preserves allowed attributes on standard elements', () => {
		const md = '<p class="badge" title="Status">Active</p>';
		const html = renderMarkdown(md);
		expect(html).toBe('<p class="badge" title="Status">Active</p>');
	});

	it('preserves image src and alt from the allowlist', () => {
		const md = '<p><img src="https://example.com/pic.png" alt="Preview"></p>';
		const html = renderMarkdown(md);
		expect(html).toBe('<p><img src="https://example.com/pic.png" alt="Preview"></p>');
	});

	it('strips inline style attributes while preserving permitted class attributes', () => {
		const md = '<p style="color: red; font-size: 20px;" class="warning">Caution</p>';
		const html = renderMarkdown(md);
		expect(html).toBe('<p class="warning">Caution</p>');
		expect(html).not.toContain('style=');
		expect(html).not.toContain('color: red');
	});

	it('strips inline event handlers like onclick and onerror', () => {
		const md =
			'<p><img src="https://example.com/pic.png" alt="Pic" onerror="alert(1)" onclick="run()"></p>';
		const html = renderMarkdown(md);
		expect(html).toBe('<p><img src="https://example.com/pic.png" alt="Pic"></p>');
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('onclick');
		expect(html).not.toContain('alert');
	});

	it('strips srcdoc and drops iframe tag completely', () => {
		const md = '<iframe srcdoc="<script>alert(1)</script>"></iframe>';
		const html = renderMarkdown(md);
		expect(html).toBe('');
		expect(html).not.toContain('srcdoc');
		expect(html).not.toContain('iframe');
	});

	it('strips unlisted attributes including id, data-*, and formaction', () => {
		const md =
			'<p><span id="sink-id" data-custom="value" formaction="/leak" title="Tooltip">text</span></p>';
		const html = renderMarkdown(md);
		expect(html).toBe('<p><span title="Tooltip">text</span></p>');
		expect(html).not.toContain('id=');
		expect(html).not.toContain('data-custom');
		expect(html).not.toContain('formaction');
	});

	it('case-insensitively strips disallowed attributes like STYLE and OnError', () => {
		const md = '<p><span STYLE="display:none" OnClick="evil()" class="visible">safe</span></p>';
		const html = renderMarkdown(md);
		expect(html).toBe('<p><span class="visible">safe</span></p>');
		expect(html).not.toMatch(/style|onclick/i);
	});

	it('handles empty and blank markdown source boundary', () => {
		expect(renderMarkdown('')).toBe('');
		expect(renderMarkdown('   ')).toBe('');
	});
});
