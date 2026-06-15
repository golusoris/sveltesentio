import { describe, it, expect } from 'vitest';
import {
	buildPlaceholderStyle,
	resolveAspectRatio,
	imageLoadingAttrs,
} from '../src/lqip';

describe('buildPlaceholderStyle', () => {
	it('returns undefined when no placeholder is supplied', () => {
		expect(buildPlaceholderStyle(undefined)).toBeUndefined();
		expect(buildPlaceholderStyle({})).toBeUndefined();
	});

	it('builds a covering background-image for a data-URI src', () => {
		const style = buildPlaceholderStyle({ src: 'data:image/png;base64,AAAA' });
		expect(style).toBe('background: url("data:image/png;base64,AAAA") center / cover no-repeat;');
	});

	it('layers a colour beneath the placeholder image', () => {
		const style = buildPlaceholderStyle({ src: '/tiny.png', color: '#222' });
		expect(style).toBe('background: url("/tiny.png") center / cover no-repeat, #222;');
	});

	it('falls back to a flat colour when only a colour is given', () => {
		expect(buildPlaceholderStyle({ color: 'rebeccapurple' })).toBe('background: rebeccapurple;');
	});

	it('escapes characters that would break out of the url() token', () => {
		const style = buildPlaceholderStyle({ src: 'a"b\\c.png' });
		expect(style).toBe('background: url("a\\"b\\\\c.png") center / cover no-repeat;');
	});
});

describe('resolveAspectRatio', () => {
	it('builds a `w / h` ratio from positive dimensions', () => {
		expect(resolveAspectRatio(1600, 900)).toBe('1600 / 900');
	});

	it('returns undefined when a dimension is missing or non-positive', () => {
		expect(resolveAspectRatio(undefined, 900)).toBeUndefined();
		expect(resolveAspectRatio(1600, undefined)).toBeUndefined();
		expect(resolveAspectRatio(0, 900)).toBeUndefined();
		expect(resolveAspectRatio(1600, -1)).toBeUndefined();
	});

	it('returns undefined for non-finite dimensions', () => {
		expect(resolveAspectRatio(Number.NaN, 900)).toBeUndefined();
		expect(resolveAspectRatio(1600, Number.POSITIVE_INFINITY)).toBeUndefined();
	});
});

describe('imageLoadingAttrs', () => {
	it('lazy-loads by default', () => {
		expect(imageLoadingAttrs()).toEqual({
			loading: 'lazy',
			fetchpriority: 'auto',
			decoding: 'async',
		});
	});

	it('eager-loads high-priority heroes with fetchpriority high', () => {
		expect(imageLoadingAttrs('high')).toEqual({
			loading: 'eager',
			fetchpriority: 'high',
			decoding: 'async',
		});
	});
});
