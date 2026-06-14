/**
 * Content-Security-Policy additions required to run EmulatorJS under an
 * otherwise-strict policy (the one produced by `@sveltesentio/core`'s
 * `strictCsp`).
 *
 * EmulatorJS instantiates WASM cores and spins up Web Workers; both clash with
 * a default `script-src 'self'` / `'strict-dynamic'` nonce policy:
 *
 * - WASM compilation needs `'wasm-unsafe-eval'` in `script-src` (the modern,
 *   narrow grant). Older engines only honour the broad `'unsafe-eval'`; callers
 *   that must support them opt in via {@link EmulatorCspOptions.wasmEvalFallback}.
 * - Cores and worker bootstrap run from `blob:` URLs → `script-src blob:`,
 *   `worker-src 'self' blob:`, `child-src blob:`.
 * - ROM / BIOS / core assets are fetched from the data base URL → that origin
 *   is added to `connect-src`, `img-src`, `media-src`.
 *
 * This module is pure and unit-tested. It deliberately does **not** import
 * `@sveltesentio/core` at runtime (to keep the dependency optional and the unit
 * tests hermetic); it mirrors that package's `CspDirectives` shape structurally
 * so {@link mergeCspDirectives} composes cleanly with `strictCsp(...)` output
 * and `serialiseCsp(...)`.
 */

/** A single CSP source token, e.g. `"'self'"`, `"blob:"`, `"https://cdn.x"`. */
export type CspSource = string;

/**
 * Structural mirror of `@sveltesentio/core`'s `CspDirectives` (the subset
 * EmulatorJS touches). Kept structural so callers can spread the merge result
 * straight into `serialiseCsp` without an adapter.
 */
export interface CspDirectives {
	'default-src'?: readonly CspSource[];
	'script-src'?: readonly CspSource[];
	'script-src-elem'?: readonly CspSource[];
	'style-src'?: readonly CspSource[];
	'img-src'?: readonly CspSource[];
	'connect-src'?: readonly CspSource[];
	'media-src'?: readonly CspSource[];
	'frame-src'?: readonly CspSource[];
	'child-src'?: readonly CspSource[];
	'worker-src'?: readonly CspSource[];
	'object-src'?: readonly CspSource[];
}

export interface EmulatorCspOptions {
	/**
	 * Base URL EmulatorJS fetches cores / ROMs / BIOS / art from
	 * (`window.EJS_pathtodata`). Its origin is added to `connect-src`,
	 * `img-src` and `media-src`. Omit when everything is served same-origin.
	 */
	dataBaseUrl?: string;
	/**
	 * Use the broad `'unsafe-eval'` instead of the narrow `'wasm-unsafe-eval'`
	 * in `script-src`. Only enable for engines that predate `'wasm-unsafe-eval'`;
	 * it materially weakens the policy. Default `false`.
	 */
	wasmEvalFallback?: boolean;
	/**
	 * Allow loading cores / workers from these extra origins (e.g. a public
	 * EmulatorJS CDN when not self-hosting). Added to `script-src`,
	 * `connect-src`, `worker-src`. Same-origin (`'self'`) is always included.
	 */
	extraScriptOrigins?: readonly CspSource[];
}

export const WASM_UNSAFE_EVAL: CspSource = "'wasm-unsafe-eval'";
export const UNSAFE_EVAL: CspSource = "'unsafe-eval'";
const SELF: CspSource = "'self'";
const BLOB: CspSource = 'blob:';
const DATA: CspSource = 'data:';

/**
 * Extract the CSP origin (`scheme://host[:port]`) from a base URL, so the
 * data host can be added to fetch/media directives without a trailing path.
 *
 * Returns `undefined` for relative / un-parseable URLs (same-origin assets need
 * no extra source). Invalid absolute URLs throw via {@link URL}; callers pass
 * already-validated config.
 */
export function originOf(url: string | undefined): CspSource | undefined {
	if (!url) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		// Relative URL (same-origin) — no extra CSP source needed.
		return undefined;
	}
	return parsed.origin;
}

/**
 * Build the CSP directive additions EmulatorJS needs. The result is meant to be
 * merged onto a strict base policy via {@link mergeCspDirectives}, not used
 * standalone (it intentionally omits `default-src`, `object-src`, etc.).
 */
export function emulatorCspDirectives(options: EmulatorCspOptions = {}): CspDirectives {
	const { dataBaseUrl, wasmEvalFallback = false, extraScriptOrigins = [] } = options;
	const wasmEval = wasmEvalFallback ? UNSAFE_EVAL : WASM_UNSAFE_EVAL;
	const dataOrigin = originOf(dataBaseUrl);

	const fetchSrc: CspSource[] = [SELF, BLOB, DATA];
	if (dataOrigin) fetchSrc.push(dataOrigin);

	const mediaSrc: CspSource[] = [SELF, BLOB];
	if (dataOrigin) mediaSrc.push(dataOrigin);

	const scriptSrc: CspSource[] = [SELF, BLOB, wasmEval, ...extraScriptOrigins];
	const workerSrc: CspSource[] = [SELF, BLOB, ...extraScriptOrigins];
	const connectSrc: CspSource[] = [SELF, ...extraScriptOrigins];
	if (dataOrigin) connectSrc.push(dataOrigin);

	return {
		'script-src': dedupe(scriptSrc),
		'worker-src': dedupe(workerSrc),
		'child-src': [SELF, BLOB],
		'connect-src': dedupe(connectSrc),
		'img-src': dedupe(fetchSrc),
		'media-src': dedupe(mediaSrc),
	};
}

/**
 * Merge EmulatorJS directive additions onto a base policy, unioning source
 * lists per directive (order-preserving, de-duplicated). Boolean / string
 * directives on the base (e.g. `upgrade-insecure-requests`) are preserved
 * untouched.
 *
 * `B` is generic so this returns the base's exact type extended with the merged
 * EmulatorJS directives — feed the result straight into `serialiseCsp`.
 */
export function mergeCspDirectives<B extends Record<string, unknown>>(
	base: B,
	additions: CspDirectives,
): B & CspDirectives {
	const out: Record<string, unknown> = { ...base };
	const entries = Object.entries(additions) as Array<[string, readonly CspSource[] | undefined]>;
	for (const [name, addValues] of entries) {
		if (addValues === undefined) continue;
		const existing: unknown = base[name];
		if (Array.isArray(existing)) {
			out[name] = dedupe([...(existing as readonly CspSource[]), ...addValues]);
		} else if (existing === undefined) {
			out[name] = dedupe([...addValues]);
		} else {
			// Base holds a non-array (boolean/string) under a name we also
			// supply as a list — should not happen for the directives we touch;
			// keep the base value rather than corrupt the policy.
			out[name] = existing;
		}
	}
	return out as B & CspDirectives;
}

function dedupe(sources: readonly CspSource[]): CspSource[] {
	return [...new Set(sources)];
}
