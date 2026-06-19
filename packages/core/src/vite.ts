import type { Plugin } from 'vite';

/** A budget map: output chunk file name → maximum allowed size in bytes. */
export type BundleBudget = Readonly<Record<string, number>>;

export interface SentioPluginOptions {
	requiredEnv?: readonly string[];
	verbose?: boolean;
	virtualModule?: Readonly<Record<string, unknown>>;
	/**
	 * Per-chunk size budgets (§2.9 perf budgets). Keys are output `fileName`s
	 * (exact match) — e.g. `{ 'entry.js': 150_000 }`. On `generateBundle`, any
	 * emitted chunk whose byte size exceeds its budget fails the build, unless
	 * {@link bundleBudgetWarnOnly} is set.
	 */
	bundleBudget?: BundleBudget;
	/** When true, over-budget chunks warn instead of failing the build. */
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
export function checkBundleBudget(
	bundle: BundleLike,
	budget: BundleBudget,
): BudgetViolation[] {
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
		(v) =>
			`  - ${v.fileName}: ${v.size} B exceeds budget ${v.budget} B (+${
				v.size - v.budget
			} B)`,
	);
	return `[sentio] Bundle-size budget exceeded:\n${lines.join('\n')}`;
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
			const entries = Object.entries(virtualModule);
			const exports = entries
				.map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`)
				.join('\n');
			return `${exports}\nexport default Object.freeze(${JSON.stringify(virtualModule)});\n`;
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
			const missing = requiredEnv.filter(
				(key) => !process.env[key] || process.env[key] === '',
			);
			if (missing.length > 0) {
				throw new Error(
					`[sentio] Missing required environment variables:\n${missing
						.map((k) => `  - ${k}`)
						.join('\n')}\nCheck your .env file or deployment environment.`,
				);
			}
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
