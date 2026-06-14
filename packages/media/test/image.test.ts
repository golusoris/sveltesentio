import { describe, it, expect } from 'vitest';
import {
	buildSrcSet,
	buildSrcSetCandidates,
	buildSizes,
	buildResponsiveImage,
} from '../src/image';

describe('buildSrcSetCandidates', () => {
	it('normalises widths: de-dupes, drops invalid, rounds, sorts ascending', () => {
		const c = buildSrcSetCandidates('/img', [640, 320, 320, -10, 0, NaN, 640.4]);
		expect(c.map((x) => x.width)).toEqual([320, 640]);
	});

	it('defaults to appending ?w= when no query present', () => {
		const c = buildSrcSetCandidates('/img', [320]);
		expect(c[0]?.url).toBe('/img?w=320');
	});

	it('merges with & when src already has a query', () => {
		const c = buildSrcSetCandidates('/img?fit=cover', [320]);
		expect(c[0]?.url).toBe('/img?fit=cover&w=320');
	});

	it('preserves a hash fragment when appending the width query', () => {
		const c = buildSrcSetCandidates('/img#frag', [320]);
		expect(c[0]?.url).toBe('/img?w=320#frag');
	});

	it('supports a {w} token string template', () => {
		const c = buildSrcSetCandidates('ignored', [320, 640], {
			template: '/images/poster/w{w}/abc.jpg',
		});
		expect(c.map((x) => x.url)).toEqual([
			'/images/poster/w320/abc.jpg',
			'/images/poster/w640/abc.jpg',
		]);
	});

	it('supports a function template', () => {
		const c = buildSrcSetCandidates('base', [200], {
			template: (w) => `https://cdn/${w * 2}`,
		});
		expect(c[0]?.url).toBe('https://cdn/400');
	});
});

describe('buildSrcSet', () => {
	it('formats candidates with w descriptors', () => {
		expect(buildSrcSet('/img', [320, 640])).toBe(
			'/img?w=320 320w, /img?w=640 640w',
		);
	});

	it('returns empty string for no widths', () => {
		expect(buildSrcSet('/img', [])).toBe('');
	});
});

describe('buildSizes', () => {
	it('emits ordered conditions plus a default 100vw fallback', () => {
		expect(
			buildSizes([
				{ condition: '(min-width: 1024px)', size: '33vw' },
				{ condition: '(min-width: 768px)', size: '50vw' },
			]),
		).toBe('(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw');
	});

	it('honours a custom fallback', () => {
		expect(buildSizes([], { fallback: '600px' })).toBe('600px');
	});

	it('returns just the fallback with no rules', () => {
		expect(buildSizes([])).toBe('100vw');
	});
});

describe('buildResponsiveImage', () => {
	it('composes src (largest width), srcset, and sizes', () => {
		const attrs = buildResponsiveImage('/poster', [320, 640, 1280], {
			sizes: [{ condition: '(min-width: 768px)', size: '50vw' }],
		});
		expect(attrs.src).toBe('/poster?w=1280');
		expect(attrs.srcset).toBe(
			'/poster?w=320 320w, /poster?w=640 640w, /poster?w=1280 1280w',
		);
		expect(attrs.sizes).toBe('(min-width: 768px) 50vw, 100vw');
	});

	it('honours an explicit fallbackWidth and sizes fallback', () => {
		const attrs = buildResponsiveImage('/poster', [320, 640], {
			fallbackWidth: 320,
			sizesFallback: '90vw',
		});
		expect(attrs.src).toBe('/poster?w=320');
		expect(attrs.sizes).toBe('90vw');
	});

	it('falls back to the raw src when no widths are given', () => {
		const attrs = buildResponsiveImage('/poster', []);
		expect(attrs.src).toBe('/poster');
		expect(attrs.srcset).toBe('');
	});

	it('uses a token template for both srcset and the src fallback', () => {
		const attrs = buildResponsiveImage('seed', [400, 800], {
			template: '/cdn/{w}.avif',
		});
		expect(attrs.src).toBe('/cdn/800.avif');
		expect(attrs.srcset).toBe('/cdn/400.avif 400w, /cdn/800.avif 800w');
	});
});
