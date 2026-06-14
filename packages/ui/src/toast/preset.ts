/**
 * Preset-aware toast sizing (ADR-0016). `svelte-sonner` does not expose
 * interface-type sizing as a first-class API, so this thin helper maps an
 * {@link InterfaceType} to the `<Toaster>` overrides (position + CSS custom
 * properties) that scale toast padding / font-size / width with the active
 * interface preset. Pure — no runtime dependency on `svelte-sonner`.
 */

import { presets, type InterfacePreset, type InterfaceType } from '../presets/index.js';

/** Anchor positions accepted by `svelte-sonner`'s `<Toaster position>`. */
export type ToastPosition =
	| 'top-left'
	| 'top-center'
	| 'top-right'
	| 'bottom-left'
	| 'bottom-center'
	| 'bottom-right';

/**
 * Sizing + placement contract a `<Toaster>` consumes. `style` is a map of CSS
 * custom properties svelte-sonner reads (`--width`, `--toast-padding`, …) plus
 * the preset font-size; spread onto the Toaster's `toastOptions.style`.
 */
export interface ToastPreset {
	readonly interface: InterfaceType;
	/** Recommended `<Toaster position>`. */
	readonly position: ToastPosition;
	/** Largest toast width for this interface (CSS length). */
	readonly width: string;
	/** Gap between stacked toasts (CSS length). */
	readonly gap: string;
	/** Distance from the viewport edge (CSS length). */
	readonly offset: string;
	/** CSS custom properties for `toastOptions.style`. */
	readonly style: Readonly<Record<string, string>>;
}

/** Per-interface placement; 10-foot/handheld center for thumb/D-pad reach. */
const POSITION: Record<InterfaceType, ToastPosition> = {
	desktop: 'bottom-right',
	dashboard: 'bottom-right',
	'10foot': 'top-center',
	handheld: 'bottom-center',
};

/** Per-interface max toast width; wider on 10-foot for legibility at distance. */
const WIDTH: Record<InterfaceType, string> = {
	desktop: '356px',
	dashboard: '320px',
	'10foot': '40rem',
	handheld: '92vw',
};

/** Multiply a `rem`/`px` length by a scalar, preserving the unit. */
function scaleLength(length: string, factor: number): string {
	const match = /^(-?\d*\.?\d+)(rem|px|em)$/.exec(length.trim());
	if (!match) return length;
	const value = Number(match[1]) * factor;
	// Trim trailing zeros so `0.750rem` -> `0.75rem`.
	return `${Number(value.toFixed(4))}${match[2]}`;
}

/**
 * Map an interface type (or a full {@link InterfacePreset}) to a
 * {@link ToastPreset}. Padding scales with the preset's `spacingScale`; the
 * minimum target size flows through so a toast's action button stays ≥ the
 * WCAG 2.2 AA floor.
 */
export function toastPreset(interfaceType: InterfaceType | InterfacePreset): ToastPreset {
	const preset: InterfacePreset =
		typeof interfaceType === 'string' ? presets[interfaceType] : interfaceType;
	const name = preset.name;
	const paddingY = scaleLength('0.75rem', preset.spacingScale);
	const paddingX = scaleLength('1rem', preset.spacingScale);
	const gap = scaleLength('0.75rem', preset.spacingScale);
	const offset = scaleLength('1rem', preset.spacingScale);

	return {
		interface: name,
		position: POSITION[name],
		width: WIDTH[name],
		gap,
		offset,
		style: {
			'--width': WIDTH[name],
			'--toast-padding': `${paddingY} ${paddingX}`,
			'--toast-gap': gap,
			'--font-size': preset.baseFontSize,
			'--border-radius': preset.radius,
			'--toast-min-target-size': preset.minTargetSize,
		},
	};
}
