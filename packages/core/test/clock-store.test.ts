import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clockStore as browserStore } from '../src/internal/clock-store.browser.js';
import { clockStore as nodeStore } from '../src/internal/clock-store.node.js';
import type { Clock } from '../src/clock.js';

const outer: Clock = { now: () => new Date('2026-01-01T00:00:00Z'), monotonic: () => 100 };
const inner: Clock = { now: () => new Date('2026-02-01T00:00:00Z'), monotonic: () => 200 };

/** Every module specifier a source file imports, statically or dynamically. */
function importSpecifiers(relativePath: string): string[] {
	const source = readFileSync(resolve(__dirname, relativePath), 'utf-8');
	const pattern = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]([^'"]+)['"]/g;
	return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('clock store, server variant', () => {
	it('binds the clock for the duration of run (positive)', () => {
		const seen = nodeStore.run(outer, () => nodeStore.getStore());
		expect(seen).toBe(outer);
	});

	it('holds no clock outside run (negative)', () => {
		expect(nodeStore.getStore()).toBeUndefined();
	});

	it('restores the outer clock after a nested run (boundary)', () => {
		nodeStore.run(outer, () => {
			expect(nodeStore.run(inner, () => nodeStore.getStore())).toBe(inner);
			expect(nodeStore.getStore()).toBe(outer);
		});
		expect(nodeStore.getStore()).toBeUndefined();
	});
});

describe('clock store, browser variant', () => {
	it('runs the callback and returns its value (positive)', () => {
		expect(browserStore.run(outer, () => 'value')).toBe('value');
	});

	it('never stores a clock, also inside run (negative)', () => {
		expect(browserStore.run(outer, () => browserStore.getStore())).toBeUndefined();
	});

	it('lets an error from the callback through (boundary)', () => {
		expect(() =>
			browserStore.run(outer, () => {
				throw new TypeError('boundary');
			}),
		).toThrow(TypeError);
	});
});

// Vite's dev server throws in the browser on a named import from a `node:`
// module, so the browser side may import nothing beyond these lists.
describe('clock store, what the browser side may import', () => {
	it('browser variant: its type file only', () => {
		expect(importSpecifiers('../src/internal/clock-store.browser.ts')).toEqual([
			'./clock-store.types.js',
		]);
	});

	it('type file: the clock type only', () => {
		expect(importSpecifiers('../src/internal/clock-store.types.ts')).toEqual(['../clock.js']);
	});

	it('clock.ts: the store through the conditional import, no node: module', () => {
		expect(importSpecifiers('../src/clock.ts')).toEqual([
			'#clock-store',
			'svelte',
			'esm-env',
			'@sveltejs/kit',
		]);
	});
});
