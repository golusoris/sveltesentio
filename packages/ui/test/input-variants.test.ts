import { describe, expect, it } from 'vitest';
import { INPUT_BASE, INPUT_INVALID, inputClass } from '../src/input/variants.js';

describe('inputClass', () => {
	it('returns the base classes by default (valid state)', () => {
		const cls = inputClass();
		expect(cls).toContain('border-input');
		expect(cls).toContain('focus-visible:ring-ring');
		expect(cls).toContain('placeholder:text-muted-foreground');
		expect(cls).not.toContain(INPUT_INVALID);
	});

	it('appends destructive classes when invalid', () => {
		const cls = inputClass(true);
		expect(cls).toContain('border-destructive');
		expect(cls).toContain('focus-visible:ring-destructive');
	});

	it('does not include invalid classes when valid', () => {
		expect(inputClass(false)).not.toContain('border-destructive');
	});

	it('appends consumer className last', () => {
		expect(inputClass(false, 'mb-2').endsWith('mb-2')).toBe(true);
		expect(inputClass(true, 'mb-2').endsWith('mb-2')).toBe(true);
	});

	it('collapses whitespace and never emits undefined', () => {
		const cls = inputClass(true, undefined);
		expect(cls).not.toMatch(/\s{2,}/);
		expect(cls).not.toContain('undefined');
	});

	it('starts from the base block', () => {
		expect(inputClass().startsWith(INPUT_BASE.split(' ')[0] ?? '')).toBe(true);
	});
});
