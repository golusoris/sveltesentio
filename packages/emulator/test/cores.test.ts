import { describe, it, expect } from 'vitest';
import {
	PLATFORM_CORES,
	knownCores,
	normaliseSlug,
	resolveCore,
} from '../src/cores.js';

describe('normaliseSlug', () => {
	it('lowercases and strips non-alphanumerics', () => {
		expect(normaliseSlug('Sega MD')).toBe('segamd');
		expect(normaliseSlug('sega-md')).toBe('segamd');
		expect(normaliseSlug('Super_Nintendo!')).toBe('supernintendo');
	});

	it('leaves an already-normalised slug unchanged', () => {
		expect(normaliseSlug('snes')).toBe('snes');
	});
});

describe('resolveCore', () => {
	it('resolves canonical core ids', () => {
		expect(resolveCore('snes')).toBe('snes');
		expect(resolveCore('n64')).toBe('n64');
		expect(resolveCore('psx')).toBe('psx');
	});

	it('resolves human platform slugs to cores', () => {
		expect(resolveCore('super-nintendo')).toBe('snes');
		expect(resolveCore('PlayStation')).toBe('psx');
		expect(resolveCore('Mega Drive')).toBe('segaMD');
		expect(resolveCore('game boy advance')).toBe('gba');
	});

	it('treats differently-punctuated slugs identically', () => {
		expect(resolveCore('sega-md')).toBe(resolveCore('Sega MD'));
		expect(resolveCore('segamd')).toBe(resolveCore('sega md'));
	});

	it('returns undefined for unknown platforms', () => {
		expect(resolveCore('dreamcast')).toBeUndefined();
		expect(resolveCore('')).toBeUndefined();
		expect(resolveCore('not-a-real-platform')).toBeUndefined();
	});
});

describe('knownCores', () => {
	it('returns a deduplicated list of cores', () => {
		const cores = knownCores();
		expect(new Set(cores).size).toBe(cores.length);
	});

	it('covers the issue-named cores (nes/snes/n64/gba/psx/segaMD/mame)', () => {
		const cores = new Set<string>(knownCores());
		for (const c of ['nes', 'snes', 'n64', 'gba', 'psx', 'segaMD', 'mame2003']) {
			expect(cores.has(c)).toBe(true);
		}
	});

	it('has at least ~25 distinct platform slug entries', () => {
		expect(Object.keys(PLATFORM_CORES).length).toBeGreaterThanOrEqual(25);
	});

	it('every PLATFORM_CORES value appears in knownCores', () => {
		const known = new Set<string>(knownCores());
		for (const core of Object.values(PLATFORM_CORES)) {
			expect(known.has(core)).toBe(true);
		}
	});
});
