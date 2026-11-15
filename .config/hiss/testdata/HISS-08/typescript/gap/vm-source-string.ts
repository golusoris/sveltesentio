// Dynamic execution through `node:vm`: each call compiles and runs a source
// string, as `eval` does, and none of `no-eval`, `no-new-func` or
// `no-implied-eval` reports it. The HISS-08 block of eslint.config.ts refuses
// the `vm` import; the `vm` specifier written as a string or a plain template,
// also under `as`, `satisfies` or `!`, in `import()` or in a call; each member
// that runs or compiles source text (`runIn*Context`, `compileFunction`,
// `SourceTextModule`) named in a call or `new`, read with a dot or a static
// key, destructured, or passed as a static argument; and `Script` constructed
// by that name or reached through `Reflect`. Not seen: a specifier or key held
// in a variable or computed at run time, and a `Script` constructed under
// another name. A test once loaded the module through a computed specifier,
// the shape below, which the member read reports.
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
