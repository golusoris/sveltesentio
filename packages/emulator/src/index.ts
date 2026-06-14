export type { EmulatorCore } from './cores.js';
export { PLATFORM_CORES, knownCores, normaliseSlug, resolveCore } from './cores.js';

export type {
	BuildEmulatorConfigOptions,
	EmulatorConfig,
	EmulatorGlobals,
	InjectEmulatorScriptDeps,
	InjectEmulatorScriptResult,
	InjectableScript,
	InsertionPoint,
	MinimalDocument,
} from './loader.js';
export {
	DEFAULT_LOADER_FILE,
	UnknownPlatformError,
	buildEmulatorConfig,
	injectEmulatorScript,
} from './loader.js';

export type { CspDirectives, CspSource, EmulatorCspOptions } from './csp.js';
export {
	UNSAFE_EVAL,
	WASM_UNSAFE_EVAL,
	emulatorCspDirectives,
	mergeCspDirectives,
	originOf,
} from './csp.js';
