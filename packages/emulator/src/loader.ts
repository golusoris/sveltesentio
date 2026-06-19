/**
 * EmulatorJS loader: builds the `window.EJS_*` config object and injects the
 * loader script.
 *
 * EmulatorJS is not a clean npm import — it is a self-hosted (or CDN) JS bundle
 * that reads a set of `window.EJS_*` globals, then boots a WASM core into a
 * target element. This module keeps the testable parts pure:
 *
 * - {@link buildEmulatorConfig} maps typed options → the `EJS_*` key/value bag
 *   (no DOM, fully unit-tested).
 * - {@link injectEmulatorScript} takes an injectable `document` so the script
 *   `src`, the target element id, and every `EJS_*` global it sets can be
 *   asserted in a plain Node test without a real browser. It returns a cleanup
 *   function that removes the script and clears the globals.
 *
 * The thin `<Emulator>` Svelte component is the only browser-only surface; it
 * delegates entirely to these functions behind a `BROWSER` guard.
 */

import { resolveCore, type EmulatorCore } from './cores.js';

/** Default filename EmulatorJS exposes as its loader entry point. */
export const DEFAULT_LOADER_FILE = 'loader.js';

/** A target the loader script can be appended to (a `<head>` / `<body>`). */
export interface InsertionPoint {
	appendChild(node: unknown): unknown;
	removeChild(node: unknown): unknown;
}

/** The minimal `document` surface {@link injectEmulatorScript} needs. */
export interface MinimalDocument {
	createElement(tagName: 'script'): InjectableScript;
	getElementById(id: string): unknown;
	readonly head: InsertionPoint | null;
	readonly body: InsertionPoint | null;
}

/** The minimal `<script>` surface we set + insert. */
export interface InjectableScript {
	src: string;
	async: boolean;
	id: string;
	parentNode: { removeChild(node: unknown): unknown } | null;
}

/** Window-like bag the `EJS_*` globals are written onto. */
export type EmulatorGlobals = Record<string, unknown>;

export interface BuildEmulatorConfigOptions {
	/** Platform slug (`"snes"`, `"playstation"`) or raw EmulatorJS core id. */
	core: string;
	/** Absolute / app-relative URL of the ROM to load. Maps to `EJS_gameUrl`. */
	gameUrl: string;
	/**
	 * Base URL of the EmulatorJS data directory (cores, art, BIOS shims).
	 * Maps to `EJS_pathtodata`. Must end in `/`; a trailing slash is added if
	 * missing. Defaults to the conventional self-hosted `"/emulatorjs/data/"`.
	 */
	dataPath?: string;
	/** CSS selector of the mount element. Maps to `EJS_player`. Default `"#game"`. */
	player?: string;
	/** Optional BIOS URL (required for psx/segaCD/etc.). Maps to `EJS_biosUrl`. */
	biosUrl?: string;
	/** Human-readable game name shown in the EmulatorJS UI (`EJS_gameName`). */
	gameName?: string;
	/** Two-letter UI language (`EJS_language`), e.g. `"en-US"`. */
	language?: string;
	/** Start the core immediately rather than showing the play button. */
	startOnLoad?: boolean;
	/** Enable the on-screen / hardware gamepad bindings UI. Default `true`. */
	gamepad?: boolean;
	/** Enable the save-state controls in the EmulatorJS menu. Default `true`. */
	saveState?: boolean;
	/** EmulatorJS UI colour (hex, no `#`), e.g. `"00bcd4"`. Maps to `EJS_color`. */
	color?: string;
	/** Extra raw `EJS_*` overrides merged last (keys WITHOUT the `EJS_` prefix). */
	extra?: Readonly<Record<string, unknown>>;
}

/** A resolved EmulatorJS config: the `EJS_*` globals plus derived metadata. */
export interface EmulatorConfig {
	/** The `EJS_*` globals to write onto `window` before the loader runs. */
	readonly globals: Readonly<Record<string, unknown>>;
	/** The resolved EmulatorJS core id. */
	readonly core: EmulatorCore;
	/** Normalised data path (guaranteed trailing slash). */
	readonly dataPath: string;
	/** Full URL of the loader script (`${dataPath}loader.js`). */
	readonly loaderUrl: string;
	/** The mount selector. */
	readonly player: string;
}

export class UnknownPlatformError extends Error {
	constructor(public readonly slug: string) {
		super(`Unknown emulator platform / core: "${slug}"`);
		this.name = 'UnknownPlatformError';
	}
}

function withTrailingSlash(path: string): string {
	return path.endsWith('/') ? path : `${path}/`;
}

/**
 * Build the EmulatorJS configuration from typed options. Pure: no DOM access,
 * deterministic, fully unit-testable.
 *
 * @throws {UnknownPlatformError} when `core` resolves to no known EmulatorJS core.
 */
export function buildEmulatorConfig(options: BuildEmulatorConfigOptions): EmulatorConfig {
	const core = resolveCore(options.core);
	if (!core) throw new UnknownPlatformError(options.core);

	const player = options.player ?? '#game';
	const dataPath = withTrailingSlash(options.dataPath ?? '/emulatorjs/data/');
	const loaderUrl = `${dataPath}${DEFAULT_LOADER_FILE}`;

	const globals: Record<string, unknown> = {
		EJS_player: player,
		EJS_core: core,
		EJS_gameUrl: options.gameUrl,
		EJS_pathtodata: dataPath,
		EJS_startOnLoaded: options.startOnLoad ?? false,
		EJS_Buttons: { gamepad: options.gamepad ?? true },
		EJS_defaultOptions: { 'save-state-slot': '1' },
		EJS_disableDatabases: false,
	};

	if (options.biosUrl !== undefined) globals.EJS_biosUrl = options.biosUrl;
	if (options.gameName !== undefined) globals.EJS_gameName = options.gameName;
	if (options.language !== undefined) globals.EJS_language = options.language;
	if (options.color !== undefined) globals.EJS_color = options.color;
	if (options.saveState === false) globals.EJS_defaultOptions = { 'save-state-slot': 'off' };

	if (options.extra) {
		for (const [key, value] of Object.entries(options.extra)) {
			globals[key.startsWith('EJS_') ? key : `EJS_${key}`] = value;
		}
	}

	return { globals, core, dataPath, loaderUrl, player };
}

export interface InjectEmulatorScriptDeps {
	/** Injectable document (real `document` in browser; a fake in tests). */
	document: MinimalDocument;
	/** Injectable globals bag (real `window` in browser; a fake in tests). */
	window?: EmulatorGlobals;
}

export interface InjectEmulatorScriptResult {
	/** The created (and inserted) script element. */
	readonly script: InjectableScript;
	/** The resolved config that was applied. */
	readonly config: EmulatorConfig;
	/** Removes the script and clears every `EJS_*` global this call set. */
	readonly cleanup: () => void;
}

const SCRIPT_ID = 'sveltesentio-emulatorjs-loader';

/**
 * Set the `EJS_*` globals and inject the EmulatorJS loader `<script>` into the
 * given document. Idempotent on the script id — a prior loader script is
 * removed first so re-mounting does not stack duplicates.
 *
 * The `document` / `window` are injected so this is unit-testable in Node: the
 * test asserts `script.src`, the globals written, and that `cleanup()` reverts
 * them.
 */
export function injectEmulatorScript(
	options: BuildEmulatorConfigOptions,
	deps: InjectEmulatorScriptDeps,
): InjectEmulatorScriptResult {
	const config = buildEmulatorConfig(options);
	const doc = deps.document;
	const win = (deps.window ?? globalThis) as EmulatorGlobals;

	// Remove any pre-existing loader script (re-mount safety).
	const prior = doc.getElementById(SCRIPT_ID);
	if (prior && isInjectableScript(prior) && prior.parentNode) {
		prior.parentNode.removeChild(prior);
	}

	const setKeys: string[] = [];
	for (const [key, value] of Object.entries(config.globals)) {
		win[key] = value;
		setKeys.push(key);
	}

	// §2.1 direct-DOM exception: injects EmulatorJS's external loader <script> at the
	// document level; a use: action cannot create a document-scoped script tag. doc injected.
	const script = doc.createElement('script');
	script.src = config.loaderUrl;
	script.async = true;
	script.id = SCRIPT_ID;

	const mount = doc.body ?? doc.head;
	if (!mount) throw new Error('injectEmulatorScript: document has no <body> or <head>');
	mount.appendChild(script);

	const cleanup = (): void => {
		if (script.parentNode) script.parentNode.removeChild(script);
		for (const key of setKeys) delete win[key];
	};

	return { script, config, cleanup };
}

function isInjectableScript(node: unknown): node is InjectableScript {
	return typeof node === 'object' && node !== null && 'src' in node;
}
