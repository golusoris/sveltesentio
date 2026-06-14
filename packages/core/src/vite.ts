import type { Plugin } from 'vite';

export interface SentioPluginOptions {
	requiredEnv?: readonly string[];
	verbose?: boolean;
	virtualModule?: Readonly<Record<string, unknown>>;
}

const VIRTUAL_ID = '$sentio';
const RESOLVED_ID = '\0$sentio';

export function sentioPlugin(options: SentioPluginOptions = {}): Plugin {
	const { requiredEnv = [], verbose = false, virtualModule = {} } = options;

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
	};
}
