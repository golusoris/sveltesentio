import { describe, it, expect, vi } from 'vitest';
import realOpenapiTS, { astToString as realAstToString } from 'openapi-typescript';
import type { OpenAPI3 } from 'openapi-typescript';
import {
	generateTypes,
	runCodegen,
	parseCodegenArgs,
	GENERATED_BANNER,
	type CodegenDeps,
	type CodegenCliDeps,
} from '../src/codegen.js';

// Tiny OpenAPI 3.1 spec fixture: one GET path with a typed JSON response.
const SPEC: OpenAPI3 = {
	openapi: '3.1.0',
	info: { title: 'Fixture API', version: '1.0.0' },
	paths: {
		'/items/{id}': {
			get: {
				operationId: 'getItem',
				parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
				responses: {
					'200': {
						description: 'ok',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { id: { type: 'string' }, ok: { type: 'boolean' } },
									required: ['id', 'ok'],
								},
							},
						},
					},
				},
			},
		},
	},
};

function fakeDeps(): CodegenDeps & {
	openapiTS: ReturnType<typeof vi.fn>;
	astToString: ReturnType<typeof vi.fn>;
} {
	const openapiTS = vi.fn(async () => ['node-a', 'node-b']);
	const astToString = vi.fn(() => 'export interface paths {}');
	return { openapiTS, astToString };
}

describe('generateTypes', () => {
	it('pipes openapiTS output through astToString and prepends the banner', async () => {
		const deps = fakeDeps();
		const out = await generateTypes(deps, { source: SPEC });
		expect(deps.openapiTS).toHaveBeenCalledOnce();
		expect(deps.astToString).toHaveBeenCalledWith(['node-a', 'node-b']);
		expect(out.startsWith(GENERATED_BANNER)).toBe(true);
		expect(out).toContain('export interface paths {}');
		expect(out.endsWith('\n')).toBe(true);
	});

	it('forwards sveltesentio defaults plus caller options to openapiTS', async () => {
		const deps = fakeDeps();
		await generateTypes(deps, { source: SPEC, openapiTSOptions: { exportType: true } });
		const passedOptions = deps.openapiTS.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(passedOptions.alphabetize).toBe(true);
		expect(passedOptions.exportType).toBe(true);
	});

	it('caller options override the defaults', async () => {
		const deps = fakeDeps();
		await generateTypes(deps, { source: SPEC, openapiTSOptions: { alphabetize: false } });
		const passedOptions = deps.openapiTS.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(passedOptions.alphabetize).toBe(false);
	});

	it('omits the banner when banner: false', async () => {
		const deps = fakeDeps();
		const out = await generateTypes(deps, { source: SPEC, banner: false });
		expect(out.startsWith(GENERATED_BANNER)).toBe(false);
		expect(out).toBe('export interface paths {}\n');
	});

	it('uses a custom banner string when provided', async () => {
		const deps = fakeDeps();
		const out = await generateTypes(deps, { source: SPEC, banner: '// custom\n' });
		expect(out.startsWith('// custom\n')).toBe(true);
	});

	it('does not double up the trailing newline', async () => {
		const deps: CodegenDeps = {
			openapiTS: async () => ['x'],
			astToString: () => 'line\n',
		};
		const out = await generateTypes(deps, { source: SPEC, banner: false });
		expect(out).toBe('line\n');
	});

	// Integration: prove the wiring against the real openapi-typescript on the fixture.
	it('generates a real typed `paths` module from the fixture spec', async () => {
		const deps: CodegenDeps = {
			openapiTS: (source, options) => realOpenapiTS(source, options),
			astToString: (ast) => realAstToString(ast as Parameters<typeof realAstToString>[0]),
		};
		const dts = await generateTypes(deps, { source: SPEC });
		expect(dts).toContain('export interface paths');
		expect(dts).toContain('/items/{id}');
		expect(dts).toContain(GENERATED_BANNER.trim());
	});
});

describe('parseCodegenArgs', () => {
	it('reads two positionals as source + outFile', () => {
		expect(parseCodegenArgs(['spec.yaml', 'out.ts'])).toEqual({
			source: 'spec.yaml',
			outFile: 'out.ts',
		});
	});

	it('reads --out flag form', () => {
		expect(parseCodegenArgs(['spec.yaml', '--out', 'out.ts'])).toEqual({
			source: 'spec.yaml',
			outFile: 'out.ts',
		});
	});

	it('reads -o short flag and --out= forms', () => {
		expect(parseCodegenArgs(['spec.yaml', '-o', 'a.ts'])).toEqual({
			source: 'spec.yaml',
			outFile: 'a.ts',
		});
		expect(parseCodegenArgs(['spec.yaml', '--out=b.ts'])).toEqual({
			source: 'spec.yaml',
			outFile: 'b.ts',
		});
	});

	it('throws when source is missing', () => {
		expect(() => parseCodegenArgs([])).toThrow(/Usage/);
	});

	it('throws when out file is missing', () => {
		expect(() => parseCodegenArgs(['spec.yaml'])).toThrow(/Usage/);
	});

	it('throws on a dangling --out flag', () => {
		expect(() => parseCodegenArgs(['spec.yaml', '--out'])).toThrow(/Missing value/);
	});
});

describe('runCodegen', () => {
	it('generates, writes, logs, and reports a summary', async () => {
		const written: Array<{ path: string; contents: string }> = [];
		const logs: string[] = [];
		const deps: CodegenCliDeps = {
			openapiTS: async () => ['n'],
			astToString: () => 'export interface paths {}',
			writeFile: async (path, contents) => {
				written.push({ path, contents });
			},
			log: (message) => logs.push(message),
		};
		const result = await runCodegen(deps, ['spec.yaml', 'out.ts']);
		expect(written).toHaveLength(1);
		expect(written[0]?.path).toBe('out.ts');
		expect(written[0]?.contents.startsWith(GENERATED_BANNER)).toBe(true);
		expect(result).toEqual({
			source: 'spec.yaml',
			outFile: 'out.ts',
			bytes: written[0]?.contents.length,
		});
		expect(logs[0]).toContain('out.ts');
	});

	it('works without a log sink', async () => {
		const deps: CodegenCliDeps = {
			openapiTS: async () => ['n'],
			astToString: () => 'export interface paths {}',
			writeFile: async () => undefined,
		};
		await expect(runCodegen(deps, ['spec.yaml', 'out.ts'])).resolves.toMatchObject({
			outFile: 'out.ts',
		});
	});
});
