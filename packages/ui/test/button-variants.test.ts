import { describe, expect, it } from 'vitest';
import {
	BUTTON_BASE,
	BUTTON_SIZES,
	BUTTON_VARIANTS,
	buttonClass,
} from '../src/button/variants.js';

describe('buttonClass', () => {
	it('defaults to the default variant + default size', () => {
		const cls = buttonClass();
		expect(cls).toContain(BUTTON_VARIANTS.default);
		expect(cls).toContain(BUTTON_SIZES.default);
		expect(cls).toContain('inline-flex');
	});

	it('always includes the shared base (focus ring + disabled affordances)', () => {
		for (const variant of Object.keys(BUTTON_VARIANTS) as (keyof typeof BUTTON_VARIANTS)[]) {
			const cls = buttonClass(variant);
			expect(cls).toContain('focus-visible:ring-2');
			expect(cls).toContain('disabled:pointer-events-none');
			expect(cls).toContain('aria-disabled:opacity-50');
		}
	});

	it('resolves token-backed colours per variant', () => {
		expect(buttonClass('destructive')).toContain('bg-destructive');
		expect(buttonClass('outline')).toContain('border-input');
		expect(buttonClass('secondary')).toContain('bg-secondary');
		expect(buttonClass('ghost')).toContain('hover:bg-accent');
		expect(buttonClass('link')).toContain('underline-offset-4');
	});

	it('maps each size to its class', () => {
		expect(buttonClass('default', 'sm')).toContain(BUTTON_SIZES.sm);
		expect(buttonClass('default', 'lg')).toContain(BUTTON_SIZES.lg);
		// icon size is square for a ≥ target-size icon-only hit area
		expect(buttonClass('default', 'icon')).toContain('w-9');
	});

	it('appends consumer className last', () => {
		const cls = buttonClass('default', 'default', 'mt-4 custom-x');
		expect(cls.endsWith('mt-4 custom-x')).toBe(true);
	});

	it('drops a falsy className and collapses whitespace', () => {
		const cls = buttonClass('ghost', 'sm', undefined);
		expect(cls).not.toMatch(/\s{2,}/);
		expect(cls).not.toContain('undefined');
	});

	it('starts with the shared base string', () => {
		expect(buttonClass().startsWith(BUTTON_BASE.split(' ')[0] ?? '')).toBe(true);
	});
});
