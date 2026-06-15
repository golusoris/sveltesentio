import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	buildCarouselOptions,
	navButtonTargetPx,
	carouselPrefersReducedMotion,
} from '../src/carousel';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

describe('buildCarouselOptions', () => {
	it('applies the documented defaults', () => {
		const opts = buildCarouselOptions();
		expect(opts.loop).toBe(false);
		expect(opts.align).toBe('start');
		expect(opts.axis).toBe('x');
		expect(opts.duration).toBe(25);
		expect(opts.dragFree).toBe(false);
	});

	it('always includes the reduced-motion breakpoint at duration 0', () => {
		const opts = buildCarouselOptions();
		expect(opts.breakpoints[REDUCED_MOTION_QUERY]).toEqual({ duration: 0 });
	});

	it('maps vertical orientation to the y axis', () => {
		expect(buildCarouselOptions({ orientation: 'vertical' }).axis).toBe('y');
		expect(buildCarouselOptions({ orientation: 'horizontal' }).axis).toBe('x');
	});

	it('passes through loop / align / duration / dragFree overrides', () => {
		const opts = buildCarouselOptions({
			loop: true,
			align: 'center',
			duration: 40,
			dragFree: true,
		});
		expect(opts).toMatchObject({ loop: true, align: 'center', duration: 40, dragFree: true });
	});
});

describe('navButtonTargetPx', () => {
	it('keeps desktop at the 32px shadcn icon default', () => {
		expect(navButtonTargetPx('desktop')).toBe(32);
	});

	it('upgrades handheld and tv to the 44px WCAG 2.5.8 enhanced target', () => {
		expect(navButtonTargetPx('handheld')).toBe(44);
		expect(navButtonTargetPx('tv')).toBe(44);
	});
});

describe('carouselPrefersReducedMotion', () => {
	const original = globalThis.matchMedia;

	afterEach(() => {
		if (original === undefined) {
			Reflect.deleteProperty(globalThis, 'matchMedia');
		} else {
			globalThis.matchMedia = original;
		}
	});

	it('returns false when matchMedia is unavailable (SSR)', () => {
		Reflect.deleteProperty(globalThis, 'matchMedia');
		expect(carouselPrefersReducedMotion()).toBe(false);
	});

	it('reflects the matchMedia result', () => {
		globalThis.matchMedia = vi.fn((query: string) => ({
			matches: query === REDUCED_MOTION_QUERY,
			media: query,
		})) as unknown as typeof globalThis.matchMedia;
		expect(carouselPrefersReducedMotion()).toBe(true);
	});
});
