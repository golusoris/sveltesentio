/**
 * Per-interface presets (ADR-0047). Each preset carries the control sizing for
 * one interface type, with the WCAG 2.2 AA target-size minimum (24px pointer,
 * 44px for touch / 10-foot TV navigation) baked into `minTargetSize`.
 */

export type InterfaceType = 'desktop' | '10foot' | 'handheld' | 'dashboard';

export interface InterfacePreset {
	readonly name: InterfaceType;
	/** Minimum interactive target size (WCAG 2.2 AA `2.5.8`). */
	readonly minTargetSize: string;
	/** Default height of single-line controls (button/input). */
	readonly controlHeight: string;
	/** Root font size the preset scales typography from. */
	readonly baseFontSize: string;
	/** Multiplier applied to the spacing scale. */
	readonly spacingScale: number;
	/** Default corner radius. */
	readonly radius: string;
	/** Emphasise focus-visible rings (TV/handheld directional navigation). */
	readonly emphasizeFocus: boolean;
}

/** Pointer-fine desktop: dense-ish, 24px target floor. */
export const presetDesktop: InterfacePreset = {
	name: 'desktop',
	minTargetSize: '24px',
	controlHeight: '2.25rem',
	baseFontSize: '16px',
	spacingScale: 1,
	radius: '0.5rem',
	emphasizeFocus: false,
};

/** 10-foot / couch: large targets, bigger type, strong focus ring for D-pad nav. */
export const preset10Foot: InterfacePreset = {
	name: '10foot',
	minTargetSize: '44px',
	controlHeight: '3.5rem',
	baseFontSize: '20px',
	spacingScale: 1.5,
	radius: '0.75rem',
	emphasizeFocus: true,
};

/** Handheld / touch: 44px touch targets, slightly larger type. */
export const presetHandheld: InterfacePreset = {
	name: 'handheld',
	minTargetSize: '44px',
	controlHeight: '3rem',
	baseFontSize: '17px',
	spacingScale: 1.25,
	radius: '0.625rem',
	emphasizeFocus: true,
};

/** Dense dashboard: tight controls for data-heavy admin surfaces. */
export const presetDashboard: InterfacePreset = {
	name: 'dashboard',
	minTargetSize: '24px',
	controlHeight: '2rem',
	baseFontSize: '14px',
	spacingScale: 0.875,
	radius: '0.375rem',
	emphasizeFocus: false,
};

export const presets: Record<InterfaceType, InterfacePreset> = {
	desktop: presetDesktop,
	'10foot': preset10Foot,
	handheld: presetHandheld,
	dashboard: presetDashboard,
};

/** Emit a preset as `--ui-*` custom-property declarations (no selector). */
export function presetToCssVars(preset: InterfacePreset): string {
	return [
		`\t--ui-min-target-size: ${preset.minTargetSize};`,
		`\t--ui-control-height: ${preset.controlHeight};`,
		`\t--ui-font-size-base: ${preset.baseFontSize};`,
		`\t--ui-spacing-scale: ${preset.spacingScale};`,
		`\t--ui-radius: ${preset.radius};`,
		`\t--ui-focus-emphasis: ${preset.emphasizeFocus ? '1' : '0'};`,
	].join('\n');
}

/**
 * Emit a preset scoped to `[data-interface="<name>"]` (default), so a single
 * document can host more than one interface region. Pass a custom `selector`
 * (e.g. `:root`) to apply globally.
 */
export function presetCss(preset: InterfacePreset, selector?: string): string {
	const sel = selector ?? `[data-interface="${preset.name}"]`;
	return `${sel} {\n${presetToCssVars(preset)}\n}`;
}
