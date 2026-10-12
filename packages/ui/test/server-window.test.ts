import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServerWindow as browserWindow } from '../src/markdown/server-window.browser.js';
import { createServerWindow as nodeWindow } from '../src/markdown/server-window.node.js';

/** Every module specifier a source file imports, statically or dynamically. */
function importSpecifiers(relativePath: string): string[] {
	const source = readFileSync(resolve(__dirname, relativePath), 'utf-8');
	const pattern = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g;
	return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('server window seam', () => {
	it('server variant builds a jsdom window with a working document (positive)', () => {
		const div = nodeWindow().document?.createElement('div');
		expect(div?.nodeName).toBe('DIV');
	});

	it('server variant builds a fresh window per call (boundary)', () => {
		// Compared outside `expect`: printing a jsdom window reads `localStorage`, which throws.
		expect(nodeWindow() === nodeWindow()).toBe(false);
	});

	it('browser variant returns the global object and builds nothing (negative)', () => {
		expect(browserWindow() === globalThis).toBe(true);
	});
});

// jsdom throws at load in a browser (`SharedArrayBuffer is not defined`), so the
// browser side may import nothing beyond these lists.
describe('server window seam, what the browser side may import', () => {
	it('browser variant: the DOMPurify types only', () => {
		expect(importSpecifiers('../src/markdown/server-window.browser.ts')).toEqual(['dompurify']);
	});

	it('sanitize.ts: the window through the conditional import, never jsdom', () => {
		expect(importSpecifiers('../src/markdown/sanitize.ts')).toEqual([
			'esm-env',
			'marked',
			'dompurify',
			'./allowlist.js',
			'#server-window',
			'./allowlist.js',
		]);
	});
});
