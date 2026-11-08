import type { Plugin } from 'vite';

/** A budget map: output file name (chunk or asset) → maximum allowed size in bytes. */
export type BundleBudget = Readonly<Record<string, number>>;

export interface SentioPluginOptions {
	requiredEnv?: readonly string[];
	verbose?: boolean;
	virtualModule?: Readonly<Record<string, unknown>>;
	/**
	 * Per-output-file size budgets in raw bytes (not the gzipped §2.9 figure).
	 * Keys are output `fileName`s (exact match) — e.g. `{ 'entry.js': 150_000 }`.
	 * A file with no matching key is not checked. On `generateBundle`, each
	 * chunk or asset already in the bundle whose `fileName` has a budget is
	 * checked; an over-budget file fails the build unless
	 * {@link bundleBudgetWarnOnly} is set. Files emitted by later plugins (such
	 * as Vite's `index.html`) and files copied from `publicDir` are not checked.
	 * Sizes are taken when the hook runs, so a later plugin can still change a
	 * file (Vite strips a 12-byte marker from CSS files after this check).
	 */
	bundleBudget?: BundleBudget;
	/** When true, over-budget files warn instead of failing the build. */
	bundleBudgetWarnOnly?: boolean;
}

const VIRTUAL_ID = '$sentio';
const RESOLVED_ID = '\0$sentio';

/** Minimal structural view of a Rollup/Rolldown output item we need to size. */
interface BundleEntry {
	type: 'chunk' | 'asset';
	code?: string;
	source?: string | Uint8Array;
}

/** A bundle is a `fileName → entry` map, as passed to `generateBundle`. */
export type BundleLike = Readonly<Record<string, BundleEntry>>;

export interface BudgetViolation {
	fileName: string;
	size: number;
	budget: number;
}

/** Byte size of a chunk's code or an asset's source. */
function entrySize(entry: BundleEntry): number {
	if (entry.type === 'chunk') {
		return entry.code === undefined ? 0 : Buffer.byteLength(entry.code, 'utf8');
	}
	const { source } = entry;
	if (source === undefined) return 0;
	if (typeof source === 'string') return Buffer.byteLength(source, 'utf8');
	return source.byteLength;
}

/**
 * Pure budget check: returns every output entry that exceeds its budget. An
 * entry with no matching budget key is unconstrained. Exported for unit tests.
 */
export function checkBundleBudget(bundle: BundleLike, budget: BundleBudget): BudgetViolation[] {
	const violations: BudgetViolation[] = [];
	for (const [fileName, entry] of Object.entries(bundle)) {
		const max = budget[fileName];
		if (max === undefined) continue;
		const size = entrySize(entry);
		if (size > max) violations.push({ fileName, size, budget: max });
	}
	return violations;
}

function formatViolations(violations: readonly BudgetViolation[]): string {
	const lines = violations.map(
		(v) => `  - ${v.fileName}: ${v.size} B exceeds budget ${v.budget} B (+${v.size - v.budget} B)`,
	);
	return `[sentio] Bundle-size budget exceeded:\n${lines.join('\n')}`;
}

/**
 * The virtual module's source: one named export per key, plus a frozen default.
 *
 * Values are JSON-serialised rather than interpolated, so a string containing a
 * quote or a newline cannot terminate the literal it is being written into.
 */
function renderVirtualModule(virtualModule: Record<string, unknown>): string {
	const exports = Object.entries(virtualModule)
		.map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`)
		.join('\n');
	return `${exports}\nexport default Object.freeze(${JSON.stringify(virtualModule)});\n`;
}

/**
 * Fails the build when a declared environment variable is absent or empty.
 *
 * Empty counts as missing: an unset variable and one set to `''` are the same
 * misconfiguration, and the second is the easier one to ship by accident. Raised
 * in `buildStart` so it surfaces before any work, naming every missing key at
 * once rather than one per run.
 */
function assertRequiredEnv(requiredEnv: readonly string[]): void {
	const missing = requiredEnv.filter((key) => !process.env[key] || process.env[key] === '');
	if (missing.length === 0) return;
	const names = missing.map((k) => `  - ${k}`).join('\n');
	throw new Error(
		`[sentio] Missing required environment variables:\n${names}\nCheck your .env file or deployment environment.`,
	);
}

export function sentioPlugin(options: SentioPluginOptions = {}): Plugin {
	const {
		requiredEnv = [],
		verbose = false,
		virtualModule = {},
		bundleBudget,
		bundleBudgetWarnOnly = false,
	} = options;

	return {
		name: 'vite-plugin-sentio',
		enforce: 'pre',

		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
			return undefined;
		},

		load(id) {
			if (id !== RESOLVED_ID) return undefined;
			return renderVirtualModule(virtualModule);
		},

		configResolved(config) {
			if (verbose) {
				console.warn('[sentio] Resolved Vite config:', {
					mode: config.mode,
					root: config.root,
					build: { outDir: config.build.outDir, ssr: config.build.ssr },
				});
			}
		},

		buildStart() {
			assertRequiredEnv(requiredEnv);
		},

		generateBundle(_options, bundle) {
			if (!bundleBudget || Object.keys(bundleBudget).length === 0) return;
			const violations = checkBundleBudget(bundle, bundleBudget);
			if (violations.length === 0) {
				if (verbose) {
					console.warn('[sentio] Bundle-size budget: all chunks within budget.');
				}
				return;
			}
			const message = formatViolations(violations);
			if (bundleBudgetWarnOnly) {
				console.warn(message);
				return;
			}
			throw new Error(message);
		},
	};
}
