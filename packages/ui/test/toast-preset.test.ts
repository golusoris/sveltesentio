import { describe, it, expect } from 'vitest';
import { toastPreset } from '../src/toast/preset.js';
import { presetHandheld, presets } from '../src/presets/index.js';

describe('toastPreset', () => {
	it('maps each interface type to a position + width', () => {
		expect(toastPreset('desktop').position).toBe('bottom-right');
		expect(toastPreset('dashboard').position).toBe('bottom-right');
		expect(toastPreset('10foot').position).toBe('top-center');
		expect(toastPreset('handheld').position).toBe('bottom-center');
		expect(toastPreset('10foot').width).toBe('40rem');
	});

	it('echoes the interface name', () => {
		for (const name of Object.keys(presets)) {
			expect(toastPreset(name as keyof typeof presets).interface).toBe(name);
		}
	});

	it('scales padding by the preset spacingScale', () => {
		// desktop spacingScale = 1 → base padding 0.75rem 1rem.
		expect(toastPreset('desktop').style['--toast-padding']).toBe('0.75rem 1rem');
		// 10foot spacingScale = 1.5 → 1.125rem 1.5rem.
		expect(toastPreset('10foot').style['--toast-padding']).toBe('1.125rem 1.5rem');
		// handheld spacingScale = 1.25 → 0.9375rem 1.25rem.
		expect(toastPreset('handheld').style['--toast-padding']).toBe('0.9375rem 1.25rem');
	});

	it('flows preset font-size, radius and min-target-size into style vars', () => {
		const p = toastPreset('10foot');
		expect(p.style['--font-size']).toBe('20px');
		expect(p.style['--border-radius']).toBe('0.75rem');
		expect(p.style['--toast-min-target-size']).toBe('44px');
		expect(p.style['--width']).toBe('40rem');
	});

	it('accepts a full InterfacePreset object, not just a name', () => {
		const byObject = toastPreset(presetHandheld);
		const byName = toastPreset('handheld');
		expect(byObject).toEqual(byName);
	});

	it('keeps width in sync between top-level field and style var', () => {
		for (const name of Object.keys(presets)) {
			const p = toastPreset(name as keyof typeof presets);
			expect(p.style['--width']).toBe(p.width);
		}
	});
});
