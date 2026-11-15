// Dynamic execution through `node:vm`: each call compiles and runs a source
// string, as `eval` does, and none of `no-eval`, `no-new-func` or
// `no-implied-eval` reports it. The HISS-08 block of eslint.config.ts refuses
// the `vm` import, a literal `import('node:vm')`, and the `runIn*Context`,
// `compileFunction`, `Script` and `SourceTextModule` calls however the module
// was reached; a test once loaded it through a computed specifier.
//
// Filed under gap/ although a gate refuses it: the coverage catalog allows one
// decider per rule and language, the engine scanner is that decider since it
// reads TypeScript, and the scanner stays silent here (cordanaLLM/praetor#1241).
interface VmModule {
	runInNewContext(code: string, context?: object): unknown;
}

export async function run(specifier: string, code: string): Promise<unknown> {
	const vm = (await import(specifier)) as VmModule;
	return vm.runInNewContext(code);
}
