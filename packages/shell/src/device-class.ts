// Device-class classification → @sveltesentio/ui interface presets.
// Pure, framework-agnostic. See ADR-0028 / ADR-0029 / issue #71.

/**
 * Interface presets exposed by `@sveltesentio/ui`. A device class maps 1:1 to
 * one of these so `<DeviceClassRoot>` can pick the preset once at the root.
 */
export type DeviceClass = 'desktop' | 'handheld' | '10foot';

/** Inputs needed to classify a device. All are cheap to read at the root. */
export interface DeviceSignals {
	/** `(pointer: coarse)` media query — true for touch / D-pad primary input. */
	readonly pointerCoarse: boolean;
	/** Logical viewport width in CSS pixels (e.g. `window.innerWidth`). */
	readonly viewportWidth: number;
	/** Explicit TV / 10-foot hint (UA, capability probe, or app config). */
	readonly tv?: boolean;
}

/**
 * Breakpoint (CSS px) at or above which a coarse-pointer device is treated as
 * a 10-foot screen rather than a handheld. Tablets and phones sit below it; a
 * living-room TV sits well above. Mirrors the `handheld`→`10foot` boundary in
 * the ui preset container queries.
 */
export const TENFOOT_MIN_WIDTH = 1280;

/**
 * Width (CSS px) below which a fine-pointer device is still treated as
 * handheld (e.g. a narrow desktop window on a touch-capable laptop reads as
 * `desktop`, but a genuinely narrow surface stays handheld).
 */
export const HANDHELD_MAX_WIDTH = 1024;

/**
 * Classify a device into one of the three interface presets.
 *
 * Precedence:
 * 1. An explicit `tv` hint always wins → `10foot`.
 * 2. A coarse pointer that is also large (≥ {@link TENFOOT_MIN_WIDTH}) → `10foot`
 *    (TV remotes report coarse pointers on big screens).
 * 3. Any other coarse pointer → `handheld` (phones, tablets, controllers).
 * 4. A fine pointer on a narrow surface (< {@link HANDHELD_MAX_WIDTH}) → `handheld`.
 * 5. Everything else → `desktop`.
 */
export function classifyDevice(signals: DeviceSignals): DeviceClass {
	const { pointerCoarse, viewportWidth, tv = false } = signals;

	if (tv) return '10foot';

	if (pointerCoarse) {
		return viewportWidth >= TENFOOT_MIN_WIDTH ? '10foot' : 'handheld';
	}

	return viewportWidth < HANDHELD_MAX_WIDTH ? 'handheld' : 'desktop';
}

/**
 * Read device signals from the current browser environment. SSR-safe: returns
 * a desktop-leaning default when `window` is unavailable so the server render
 * never throws.
 */
export function readDeviceSignals(): DeviceSignals {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return { pointerCoarse: false, viewportWidth: HANDHELD_MAX_WIDTH };
	}

	return {
		pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
		viewportWidth: window.innerWidth,
	};
}
