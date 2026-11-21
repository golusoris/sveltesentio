import { describe, it, expect } from 'vitest';
import { toastPreset } from '../src/toast/preset.js';
import {
	presetDashboard,
	presetDesktop,
	presetHandheld,
	presets,
	type InterfacePreset,
} from '../src/presets/index.js';

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

	it('builds svelte-sonner toaster props for 10foot and desktop presets', () => {
		const tenFoot = toastPreset('10foot');
		expect(tenFoot.toaster).toEqual({
			position: 'top-center',
			offset: '1.5rem',
			gap: 18,
			toastOptions: {
				style:
					'--width: 40rem; --border-radius: 0.75rem; padding: 1.125rem 1.5rem; font-size: 20px; inset-inline-end: calc((100% - var(--width)) / 2);',
				actionButtonStyle: 'min-height: 44px; min-width: 44px;',
				cancelButtonStyle: 'min-height: 44px; min-width: 44px;',
			},
		});

		const desktop = toastPreset('desktop');
		expect(desktop.toaster.toastOptions.style).toBe(
			'--width: 356px; --border-radius: 0.5rem; padding: 0.75rem 1rem; font-size: 16px;',
		);
		expect(desktop.toaster.toastOptions.style).not.toContain('inset-inline-end');
		expect(toastPreset('dashboard').toaster.toastOptions.style).not.toContain('inset-inline-end');
		expect(toastPreset('handheld').toaster.toastOptions.style).toContain(
			'inset-inline-end: calc((100% - var(--width)) / 2);',
		);
	});

	it('keeps toaster fields consistent and semicolon-terminated across every preset', () => {
		for (const preset of Object.values(presets)) {
			const p = toastPreset(preset);
			expect(p.toaster.toastOptions.style.endsWith(';')).toBe(true);
			expect(p.toaster.toastOptions.style).not.toContain('undefined');
			expect(p.toaster.position).toBe(p.position);
			expect(p.toaster.offset).toBe(p.offset);
			expect(p.toaster.gap).toBe(0.75 * 16 * preset.spacingScale);
		}
	});

	it('handles spacingScale boundaries (0 and 0.875 dashboard)', () => {
		const zeroScale: InterfacePreset = { ...presetDesktop, spacingScale: 0 };
		const zero = toastPreset(zeroScale);
		expect(zero.toaster.gap).toBe(0);
		expect(zero.toaster.toastOptions.style).toContain('padding: 0rem 0rem;');

		const dashboard = toastPreset(presetDashboard);
		expect(dashboard.toaster.gap).toBe(10.5);
	});

	it('omits unread custom properties from toaster.toastOptions.style', () => {
		const unreadKeys = [
			'--toast-padding',
			'--toast-gap',
			'--font-size',
			'--toast-min-target-size',
		] as const;
		for (const preset of Object.values(presets)) {
			const style = toastPreset(preset).toaster.toastOptions.style;
			for (const key of unreadKeys) {
				expect(style).not.toContain(key);
			}
		}
	});
});
