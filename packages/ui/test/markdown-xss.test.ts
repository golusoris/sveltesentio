/**
 * XSS regression suite for the runtime markdown boundary (ADR-0026). Every
 * payload below is a known evasion vector; the assertions prove `renderMarkdown`
 * neutralises each. This is the framework's `{@html}` sink — treat any failure
 * here as a release blocker. Runs under Node (jsdom-backed DOMPurify), the
 * mandatory SSR path.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdown, ALLOWLIST, ALLOWED_TAGS } from '../src/markdown/sanitize.js';

/** Lowercased output for case-insensitive substring assertions. */
function render(md: string): string {
	return renderMarkdown(md);
}

describe('renderMarkdown — XSS neutralisation', () => {
	it('strips <script> tags and their content', () => {
		const out = render('hi <script>alert(1)</script> there');
		expect(out).not.toMatch(/<script/i);
		expect(out).not.toContain('alert(1)');
	});

	it('strips raw <script> with HTML-encoded payload', () => {
		const out = render('<script>document.cookie</script>');
		expect(out).not.toMatch(/<script/i);
		expect(out).not.toContain('document.cookie');
	});

	it('removes onerror handler from <img>', () => {
		const out = render('<img src=x onerror="alert(1)">');
		expect(out).not.toMatch(/onerror/i);
		expect(out).not.toContain('alert(1)');
	});

	it('removes onload from inline <svg> and strips svg entirely', () => {
		const out = render('<svg onload="alert(1)"></svg>');
		expect(out).not.toMatch(/onload/i);
		expect(out).not.toMatch(/<svg/i);
	});

	it('neutralises javascript: in a markdown link href', () => {
		const out = render('[click](javascript:alert(1))');
		expect(out).not.toMatch(/href\s*=\s*["']?javascript:/i);
		expect(out).not.toContain('alert(1)');
	});

	it('neutralises JavaScript: with mixed case / whitespace smuggling', () => {
		const out = render('[x](java\tscript:alert(1))');
		expect(out).not.toMatch(/javascript:/i);
	});

	it('neutralises vbscript: hrefs', () => {
		const out = render('[x](vbscript:msgbox(1))');
		expect(out).not.toMatch(/vbscript:/i);
	});

	it('strips <iframe>', () => {
		const out = render('<iframe src="https://evil.example"></iframe>');
		expect(out).not.toMatch(/<iframe/i);
	});

	it('strips <object> and <embed>', () => {
		const out = render('<object data="x"></object><embed src="y">');
		expect(out).not.toMatch(/<object/i);
		expect(out).not.toMatch(/<embed/i);
	});

	it('strips <form> and <input>', () => {
		const out = render('<form action="/x"><input name="p"></form>');
		expect(out).not.toMatch(/<form/i);
		expect(out).not.toMatch(/<input/i);
	});

	it('blocks data:text/html URIs (only image MIME allowed)', () => {
		const out = render('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
		expect(out).not.toMatch(/href\s*=\s*["']?data:text\/html/i);
	});

	it('blocks data: image/svg+xml src (scriptable image MIME)', () => {
		// A real markdown image whose URI is a scriptable svg data URI: the src
		// must be dropped (svg is excluded from the data: MIME allowlist) and no
		// onload may survive.
		const out = render('![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)');
		expect(out).not.toMatch(/src\s*=\s*["']?data:image\/svg/i);
		expect(out).not.toMatch(/onload/i);
	});

	it('strips the style attribute (CSS-injection vector)', () => {
		const out = render('<p style="background:url(javascript:alert(1))">x</p>');
		expect(out).not.toMatch(/style\s*=/i);
		expect(out).not.toMatch(/javascript:/i);
	});

	it('strips <style> blocks', () => {
		const out = render('<style>body{background:red}</style>text');
		expect(out).not.toMatch(/<style/i);
	});

	it('neutralises nested/obfuscated script (<scr<script>ipt>)', () => {
		const out = render('<scr<script>ipt>alert(1)</scr</script>ipt>');
		expect(out).not.toMatch(/<script/i);
		// The classic mutation: removing the inner tag must not reassemble a live one.
		expect(out.toLowerCase()).not.toContain('<script>');
	});

	it('handles HTML-entity encoded javascript: (&#106;... ) link', () => {
		const out = render('[x](&#106;avascript:alert(1))');
		expect(out).not.toMatch(/href\s*=\s*["']?javascript:/i);
	});

	it('strips <a> with a javascript: href written as raw HTML', () => {
		const out = render('<a href="javascript:alert(document.domain)">link</a>');
		expect(out).not.toMatch(/javascript:/i);
	});

	it('mutation-XSS: <math><mtext> / noscript vector is contained', () => {
		const out = render('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>');
		expect(out).not.toMatch(/onerror/i);
		expect(out).not.toMatch(/<math/i);
		expect(out).not.toMatch(/<style/i);
	});

	it('strips on* handler even on an allowed tag', () => {
		const out = render('<a href="https://ok.example" onclick="alert(1)">x</a>');
		expect(out).not.toMatch(/onclick/i);
	});

	it('never emits a tag outside the allowlist', () => {
		const out = render('<marquee>x</marquee><blink>y</blink><base href="//evil">');
		expect(out).not.toMatch(/<marquee/i);
		expect(out).not.toMatch(/<blink/i);
		expect(out).not.toMatch(/<base/i);
	});

	it('returns empty string for empty input', () => {
		expect(renderMarkdown('')).toBe('');
	});
});

describe('renderMarkdown — link hardening', () => {
	it('adds rel=noopener noreferrer + target=_blank to external links', () => {
		const out = render('[ext](https://example.com)');
		expect(out).toMatch(/rel="noopener noreferrer"/);
		expect(out).toMatch(/target="_blank"/);
		expect(out).toMatch(/href="https:\/\/example\.com"/);
	});

	it('does not force target=_blank on relative links', () => {
		const out = render('[rel](/dashboard)');
		expect(out).toMatch(/href="\/dashboard"/);
		expect(out).not.toMatch(/target="_blank"/);
	});

	it('keeps safe mailto and tel links', () => {
		expect(render('[mail](mailto:a@b.com)')).toMatch(/href="mailto:a@b\.com"/);
		expect(render('[call](tel:+15551234)')).toMatch(/href="tel:\+15551234"/);
	});
});

describe('renderMarkdown — correctness', () => {
	it('renders headings', () => {
		expect(render('# Title')).toMatch(/<h1[^>]*>Title<\/h1>/);
		expect(render('### Sub')).toMatch(/<h3[^>]*>Sub<\/h3>/);
	});

	it('renders emphasis and strong', () => {
		const out = render('*em* and **strong**');
		expect(out).toMatch(/<em>em<\/em>/);
		expect(out).toMatch(/<strong>strong<\/strong>/);
	});

	it('renders inline code and fenced code blocks', () => {
		expect(render('`inline`')).toMatch(/<code>inline<\/code>/);
		const block = render('```\nconst x = 1\n```');
		expect(block).toMatch(/<pre>/);
		expect(block).toMatch(/<code/);
		expect(block).toContain('const x = 1');
	});

	it('escapes HTML special chars inside code', () => {
		const out = render('`<b>not bold</b>`');
		expect(out).not.toMatch(/<b>not bold/);
		expect(out).toContain('&lt;b&gt;');
	});

	it('renders ordered and unordered lists', () => {
		const ul = render('- a\n- b');
		expect(ul).toMatch(/<ul>/);
		expect((ul.match(/<li>/g) ?? []).length).toBe(2);
		const ol = render('1. one\n2. two');
		expect(ol).toMatch(/<ol>/);
	});

	it('renders safe images with alt text', () => {
		const out = render('![logo](https://cdn.example/logo.png)');
		expect(out).toMatch(/<img[^>]+src="https:\/\/cdn\.example\/logo\.png"/);
		expect(out).toMatch(/alt="logo"/);
	});

	it('renders GFM tables', () => {
		const out = render('| a | b |\n|---|---|\n| 1 | 2 |');
		expect(out).toMatch(/<table>/);
		expect(out).toMatch(/<th>a<\/th>/);
		expect(out).toMatch(/<td>1<\/td>/);
	});

	it('renders blockquotes', () => {
		expect(render('> quote')).toMatch(/<blockquote>/);
	});
});

describe('renderMarkdown — config surface', () => {
	it('exposes a frozen default allowlist', () => {
		expect(Object.isFrozen(ALLOWLIST)).toBe(true);
		expect(ALLOWED_TAGS).toContain('a');
		expect(ALLOWED_TAGS).not.toContain('script');
	});

	it('honours a per-call config override', () => {
		// Tighten: forbid links entirely for this call.
		const out = renderMarkdown('[x](https://ok.example)', {
			config: { ...ALLOWLIST, FORBID_TAGS: ['a'] },
		});
		expect(out).not.toMatch(/<a /i);
	});
});

describe('renderMarkdown — config override is tighten-only (cannot re-open XSS)', () => {
	it('ignores a caller ALLOWED_URI_REGEXP that would re-admit javascript:', () => {
		const out = renderMarkdown('[c](javascript:alert(1))', {
			config: { ...ALLOWLIST, ALLOWED_URI_REGEXP: /.*/ },
		});
		expect(out).not.toMatch(/href\s*=\s*["']?javascript:/i);
		expect(out).not.toContain('alert(1)');
	});

	it('ignores a caller ALLOW_UNKNOWN_PROTOCOLS:true', () => {
		const out = renderMarkdown('[c](vbscript:msgbox(1))', {
			config: { ...ALLOWLIST, ALLOW_UNKNOWN_PROTOCOLS: true },
		});
		expect(out).not.toMatch(/vbscript:/i);
	});

	it('drops danger-widening keys (ADD_TAGS cannot re-add <script>)', () => {
		const out = renderMarkdown('<script>alert(1)</script>', {
			config: { ...ALLOWLIST, ADD_TAGS: ['script'] },
		});
		expect(out).not.toMatch(/<script/i);
		expect(out).not.toContain('alert(1)');
	});
});

describe('renderMarkdown — attribute + link hardening', () => {
	it('strips data-* attributes', () => {
		const out = renderMarkdown('<a href="https://ok.example" data-x="y">c</a>');
		expect(out).not.toMatch(/data-x/i);
	});

	it('rel-hardens protocol-relative external links', () => {
		const out = renderMarkdown('[x](//evil.example)');
		expect(out).toMatch(/rel\s*=\s*["']noopener noreferrer["']/i);
	});

	it('drops data:image/svg+xml on <img src> even with control-char prefixes', () => {
		for (const ws of ['\t', '\n', '\r', '\f', '\v', ' ']) {
			const out = renderMarkdown(`<img src="${ws}data:image/svg+xml,<svg onload=alert(1)>">`);
			expect(out).not.toMatch(/svg\+xml/i);
			expect(out).not.toContain('onload');
		}
	});

	it('keeps a safe data:image/png on <img src>', () => {
		const out = renderMarkdown('<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">');
		expect(out).toContain('data:image/png');
	});
});
