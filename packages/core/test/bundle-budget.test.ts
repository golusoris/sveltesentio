import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkBundleBudget,
	sentioPlugin,
	type BundleLike,
} from '../src/vite';

const chunk = (code: string): BundleLike[string] => ({ type: 'chunk', code });
const asset = (source: string | Uint8Array): BundleLike[string] => ({
	type: 'asset',
	source,
});

/** Pull a Vite hook handler out of its `ObjectHook | Function` wrapper. */
function handlerOf<T>(hook: T): T extends { handler: infer H } ? H : T {
	return (typeof hook === 'function' ? hook : (hook as { handler: unknown }).handler) as never;
}

describe('checkBundleBudget', () => {
	it('returns no violations when every chunk is within budget', () => {
		const bundle: BundleLike = {
			'entry.js': chunk('a'.repeat(100)),
			'vendor.js': chunk('b'.repeat(50)),
		};
		expect(checkBundleBudget(bundle, { 'entry.js': 200, 'vendor.js': 60 })).toEqual([]);
	});

	it('flags an over-budget chunk with its actual byte size', () => {
		const bundle: BundleLike = { 'entry.js': chunk('x'.repeat(300)) };
		const v = checkBundleBudget(bundle, { 'entry.js': 100 });
		expect(v).toEqual([{ fileName: 'entry.js', size: 300, budget: 100 }]);
	});

	it('ignores chunks that have no matching budget key', () => {
		const bundle: BundleLike = { 'unbudgeted.js': chunk('y'.repeat(9999)) };
		expect(checkBundleBudget(bundle, { 'entry.js': 1 })).toEqual([]);
	});

	it('sizes assets (string + Uint8Array sources) and multi-byte utf8', () => {
		const bundle: BundleLike = {
			'a.css': asset('z'.repeat(40)),
			'b.bin': asset(new Uint8Array(70)),
			'c.txt': asset('€'), // 3 bytes in utf8
		};
		const v = checkBundleBudget(bundle, { 'a.css': 30, 'b.bin': 70, 'c.txt': 2 });
		expect(v).toEqual([
			{ fileName: 'a.css', size: 40, budget: 30 },
			{ fileName: 'c.txt', size: 3, budget: 2 },
		]);
	});

	it('treats missing code/source as zero bytes', () => {
		const bundle: BundleLike = {
			'empty.js': { type: 'chunk' },
			'empty.css': { type: 'asset' },
		};
		expect(checkBundleBudget(bundle, { 'empty.js': 0, 'empty.css': 0 })).toEqual([]);
	});
});

describe('sentioPlugin generateBundle gate', () => {
	const warn = vi.spyOn(console, 'warn');

	beforeEach(() => warn.mockImplementation(() => undefined));
	afterEach(() => warn.mockReset());

	const run = (p: ReturnType<typeof sentioPlugin>, bundle: BundleLike): void => {
		const gen = handlerOf(p.generateBundle);
		(gen as (o: unknown, b: BundleLike) => void).call(null as never, {}, bundle);
	};

	it('is a no-op when no budget is configured', () => {
		const p = sentioPlugin();
		expect(() => run(p, { 'entry.js': chunk('x'.repeat(9999)) })).not.toThrow();
	});

	it('is a no-op for an empty budget map', () => {
		const p = sentioPlugin({ bundleBudget: {} });
		expect(() => run(p, { 'entry.js': chunk('x'.repeat(9999)) })).not.toThrow();
	});

	it('passes when chunks are within budget', () => {
		const p = sentioPlugin({ bundleBudget: { 'entry.js': 100 } });
		expect(() => run(p, { 'entry.js': chunk('ok') })).not.toThrow();
	});

	it('logs a within-budget confirmation when verbose', () => {
		const p = sentioPlugin({ bundleBudget: { 'entry.js': 100 }, verbose: true });
		run(p, { 'entry.js': chunk('ok') });
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('all chunks within budget'),
		);
	});

	it('throws and names the offending chunk when over budget', () => {
		const p = sentioPlugin({ bundleBudget: { 'entry.js': 10 } });
		expect(() => run(p, { 'entry.js': chunk('x'.repeat(50)) })).toThrow(
			/entry\.js: 50 B exceeds budget 10 B/,
		);
	});

	it('warns instead of throwing when bundleBudgetWarnOnly is set', () => {
		const p = sentioPlugin({
			bundleBudget: { 'entry.js': 10 },
			bundleBudgetWarnOnly: true,
		});
		expect(() => run(p, { 'entry.js': chunk('x'.repeat(50)) })).not.toThrow();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('budget exceeded'));
	});
});
