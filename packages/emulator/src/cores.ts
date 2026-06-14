/**
 * Platform-slug → EmulatorJS core mapping.
 *
 * EmulatorJS reads `window.EJS_core` as a core identifier (e.g. `"snes"`,
 * `"n64"`) and downloads the matching WASM core from its data directory.
 * Downstream apps think in human platform slugs (`"super-nintendo"`,
 * `"playstation"`); this module is the single, audited translation table so
 * those callers never hard-code EmulatorJS-internal core names.
 *
 * Source of truth: EmulatorJS supported systems list. Kept pure + tested so a
 * core rename upstream is caught by a failing unit test, not at runtime in a
 * downstream browser.
 */

/** Canonical EmulatorJS core identifiers (the value written to `EJS_core`). */
export type EmulatorCore =
	| 'nes'
	| 'snes'
	| 'n64'
	| 'gb'
	| 'gba'
	| 'nds'
	| 'vb'
	| 'segaMS'
	| 'segaMD'
	| 'segaGG'
	| 'segaCD'
	| 'sega32x'
	| 'segaSaturn'
	| 'psx'
	| 'pce'
	| 'ngp'
	| 'ws'
	| 'lynx'
	| 'a2600'
	| 'a5200'
	| 'a7800'
	| 'jaguar'
	| 'mame2003'
	| 'arcade'
	| 'coleco'
	| 'pcfx';

/**
 * Map of accepted platform slugs to the EmulatorJS core they resolve to.
 *
 * Multiple slugs may resolve to one core (e.g. `"snes"` and
 * `"super-nintendo"`). Slugs are matched case-insensitively after stripping
 * non-alphanumerics (see {@link resolveCore}), so `"Sega MD"`, `"sega-md"` and
 * `"segamd"` all resolve identically.
 */
export const PLATFORM_CORES: Readonly<Record<string, EmulatorCore>> = {
	// Nintendo
	nes: 'nes',
	famicom: 'nes',
	snes: 'snes',
	supernintendo: 'snes',
	sfc: 'snes',
	n64: 'n64',
	nintendo64: 'n64',
	gb: 'gb',
	gameboy: 'gb',
	gbc: 'gb',
	gameboycolor: 'gb',
	gba: 'gba',
	gameboyadvance: 'gba',
	nds: 'nds',
	ds: 'nds',
	nintendods: 'nds',
	vb: 'vb',
	virtualboy: 'vb',
	// Sega
	sms: 'segaMS',
	mastersystem: 'segaMS',
	segams: 'segaMS',
	md: 'segaMD',
	genesis: 'segaMD',
	megadrive: 'segaMD',
	segamd: 'segaMD',
	gg: 'segaGG',
	gamegear: 'segaGG',
	segagg: 'segaGG',
	segacd: 'segaCD',
	megacd: 'segaCD',
	sega32x: 'sega32x',
	saturn: 'segaSaturn',
	segasaturn: 'segaSaturn',
	// Sony
	psx: 'psx',
	ps1: 'psx',
	playstation: 'psx',
	psone: 'psx',
	// NEC
	pce: 'pce',
	pcengine: 'pce',
	turbografx: 'pce',
	turbografx16: 'pce',
	pcfx: 'pcfx',
	// SNK
	ngp: 'ngp',
	neogeopocket: 'ngp',
	// Bandai
	ws: 'ws',
	wonderswan: 'ws',
	// Atari
	lynx: 'lynx',
	atarilynx: 'lynx',
	a2600: 'a2600',
	atari2600: 'a2600',
	a5200: 'a5200',
	atari5200: 'a5200',
	a7800: 'a7800',
	atari7800: 'a7800',
	jaguar: 'jaguar',
	atarijaguar: 'jaguar',
	// Arcade
	arcade: 'arcade',
	mame: 'mame2003',
	mame2003: 'mame2003',
	// Other
	coleco: 'coleco',
	colecovision: 'coleco',
};

/** Normalise a platform slug for lookup: lowercase, strip non-alphanumerics. */
export function normaliseSlug(slug: string): string {
	return slug.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a human platform slug (or a raw EmulatorJS core id) to a core.
 *
 * Returns `undefined` for unknown slugs so the caller can surface a typed
 * error rather than booting EmulatorJS with a garbage core that 404s the WASM.
 */
export function resolveCore(slug: string): EmulatorCore | undefined {
	return PLATFORM_CORES[normaliseSlug(slug)];
}

/** The set of distinct cores this package knows how to address. */
export function knownCores(): readonly EmulatorCore[] {
	return [...new Set(Object.values(PLATFORM_CORES))];
}
