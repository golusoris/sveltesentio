/**
 * Preset-aware toast sizing (ADR-0016). `svelte-sonner` does not expose
 * interface-type sizing as a first-class API, so this thin helper maps an
 * {@link InterfaceType} to the `<Toaster>` overrides (`position`, `offset`,
 * stacking `gap` in px, toaster `<ol>` `style` `min-width`, and `toastOptions`
 * inline styles for `--width`, `--border-radius`, `padding`, `font-size`, and
 * action/cancel button minimum target size) that reach a mounted toast. Pure —
 * no runtime dependency on `svelte-sonner`.
 */

import { presets, type InterfacePreset, type InterfaceType } from '../presets/index.js';

/** Anchor positions accepted by `svelte-sonner`'s `<Toaster position>`. */
export type ToastPosition =
	'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/**
 * `<Toaster>` props shaped for direct spread onto `svelte-sonner`'s
 * `<Toaster {...p.toaster} />` (ADR-0016, #643).
 */
export interface ToasterPreset {
	/** Recommended `<Toaster position>`. */
	readonly position: ToastPosition;
	/** Distance from the viewport edge (CSS length, matching {@link ToastPreset.offset}). */
	readonly offset: string;
	/**
	 * Gap between stacked toasts in CSS px (`ToastPreset.gap` converted at
	 * `1rem = 16px`, the CSS initial root font size).
	 */
	readonly gap: number;
	/**
	 * Inline style for every toaster `<ol>` (`<Toaster style>`):
	 * `min-width: min(<width>, 100% - 2 * <offset>)` widens each position-group
	 * list to the preset width capped at the viewport minus both offsets, so
	 * per-toast `position` overrides keep their alignment; `svelte-sonner`'s
	 * mobile `width: 100%` is unaffected.
	 */
	readonly style: string;
	/**
	 * Per-toast inline styles forwarded by `<Toaster toastOptions>`: toast box
	 * sizing with `--width: min(<width>, 100%)` so a toast never exceeds its
	 * toaster list (`style`) and WCAG 2.2 SC 2.5.8 target-size floor on
	 * action/cancel buttons (`actionButtonStyle`, `cancelButtonStyle`).
	 */
	readonly toastOptions: {
		readonly style: string;
		readonly actionButtonStyle: string;
		readonly cancelButtonStyle: string;
	};
}

/**
 * Sizing + placement contract for an interface preset. Spread {@link toaster}
 * onto `svelte-sonner`'s `<Toaster {...p.toaster} />`; {@link style} is retained
 * as an object map of the raw preset values for inspection (not read by
 * `svelte-sonner`, which expects a semicolon-terminated inline style string).
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
	/**
	 * Object map of preset sizing values. Retained for append-only compatibility;
	 * not read by `svelte-sonner` — pass {@link toaster} to `<Toaster>` instead.
	 */
	readonly style: Readonly<Record<string, string>>;
	/** Ready-to-spread `<Toaster {...p.toaster} />` props for `svelte-sonner`. */
	readonly toaster: ToasterPreset;
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

/** Base stacking gap between toasts in `rem` before `spacingScale`. */
const GAP_REM = 0.75;

/** CSS initial root font size (`1rem = 16px`). */
const REM_PX = 16;

/** Round a scaled length to 4 decimals, trimming trailing zeros (`0.750` -> `0.75`). */
function roundLength(value: number): number {
	return Number(value.toFixed(4));
}

/** Multiply a `rem`/`px` length by a scalar, preserving the unit. */
function scaleLength(length: string, factor: number): string {
	const match = /^(-?\d*\.?\d+)(rem|px|em)$/.exec(length.trim());
	if (!match) return length;
	const value = Number(match[1]) * factor;
	return `${roundLength(value)}${match[2]}`;
}

/** Format `[property, value]` pairs as a semicolon-terminated inline style string. */
function declarations(entries: ReadonlyArray<readonly [string, string]>): string {
	return entries.map(([prop, val]) => `${prop}: ${val};`).join(' ');
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
	const position = POSITION[name];
	const width = WIDTH[name];
	const paddingY = scaleLength('0.75rem', preset.spacingScale);
	const paddingX = scaleLength('1rem', preset.spacingScale);
	const padding = `${paddingY} ${paddingX}`;
	const gap = scaleLength(`${GAP_REM}rem`, preset.spacingScale);
	const offset = scaleLength('1rem', preset.spacingScale);
	const buttonStyle = declarations([
		['min-height', preset.minTargetSize],
		['min-width', preset.minTargetSize],
	]);
	const toasterStyle = declarations([['min-width', `min(${width}, 100% - 2 * ${offset})`]]);
	const toastStyle = declarations([
		['--width', `min(${width}, 100%)`],
		['--border-radius', preset.radius],
		['padding', padding],
		['font-size', preset.baseFontSize],
	]);

	return {
		interface: name,
		position,
		width,
		gap,
		offset,
		style: {
			'--width': width,
			'--toast-padding': padding,
			'--toast-gap': gap,
			'--font-size': preset.baseFontSize,
			'--border-radius': preset.radius,
			'--toast-min-target-size': preset.minTargetSize,
		},
		toaster: {
			position,
			offset,
			gap: roundLength(GAP_REM * preset.spacingScale * REM_PX),
			style: toasterStyle,
			toastOptions: {
				style: toastStyle,
				actionButtonStyle: buttonStyle,
				cancelButtonStyle: buttonStyle,
			},
		},
	};
}
