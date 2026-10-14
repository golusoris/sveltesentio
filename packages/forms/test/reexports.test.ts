import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// The `sveltekit-superforms` root entry imports `SuperDebug.svelte`, which the
// Node runner here cannot compile. The mock rebuilds the root from the real
// upstream modules it re-exports, so the identity checks below still compare
// against upstream functions. The paths repeat inside the factory because
// `vi.mock` is hoisted above the constants.
vi.mock('sveltekit-superforms', async () => {
	const client = (await import('sveltekit-superforms/client')) as Record<string, unknown>;
	const errPath = '../../node_modules/sveltekit-superforms/dist/errors.js';
	const spPath = '../../node_modules/sveltekit-superforms/dist/stringPath.js';
	const uPath = '../../node_modules/sveltekit-superforms/dist/utils.js';
	const errors = (await import(/* @vite-ignore */ errPath)) as Record<string, unknown>;
	const sp = (await import(/* @vite-ignore */ spPath)) as Record<string, unknown>;
	const utils = (await import(/* @vite-ignore */ uPath)) as Record<string, unknown>;
	return {
		...client,
		...errors,
		...sp,
		...utils,
	};
});

import * as formsIndex from '../src/index.js';
import { problemToFieldErrors as localProblemToFieldErrors } from '../src/problem-to-field-errors.js';
import * as formsServer from '../src/server.js';
import { superValidate as localSuperValidate } from '../src/super-validate.js';
import * as upstreamClient from 'sveltekit-superforms/client';
import * as upstreamServer from 'sveltekit-superforms/server';

const errorsPath = '../../node_modules/sveltekit-superforms/dist/errors.js';
const stringPath = '../../node_modules/sveltekit-superforms/dist/stringPath.js';
const utilsPath = '../../node_modules/sveltekit-superforms/dist/utils.js';

const errorsModule = (await import(/* @vite-ignore */ errorsPath)) as Record<string, unknown>;
const stringPathModule = (await import(/* @vite-ignore */ stringPath)) as Record<string, unknown>;
const utilsModule = (await import(/* @vite-ignore */ utilsPath)) as Record<string, unknown>;

const upstreamAll: Record<string, unknown> = {
	...upstreamClient,
	...errorsModule,
	...stringPathModule,
	...utilsModule,
};

describe('re-export surface (append-only API, HISS-14)', () => {
	describe('src/server.ts re-exports', () => {
		const SERVER_SUPERFORMS_EXPORTS = [
			'message',
			'setError',
			'setMessage',
			'actionResult',
			'defaults',
			'defaultValues',
			'withFiles',
			'removeFiles',
		] as const;

		it.each(SERVER_SUPERFORMS_EXPORTS)(
			're-exports %s identically to sveltekit-superforms/server',
			(name) => {
				const formsValue = formsServer[name as keyof typeof formsServer];
				const upstreamValue = upstreamServer[name as keyof typeof upstreamServer];
				expect(formsValue).toBeDefined();
				expect(formsValue).toBe(upstreamValue);
			},
		);

		it('re-exports local server utilities identically', () => {
			expect(formsServer.superValidate).toBe(localSuperValidate);
			expect(formsServer.problemToFieldErrors).toBe(localProblemToFieldErrors);
		});
	});

	describe('src/index.ts re-exports', () => {
		const INDEX_SUPERFORMS_EXPORTS = [
			'superForm',
			'message',
			'setError',
			'setMessage',
			'fail',
			'actionResult',
			'defaults',
			'defaultValues',
			'schemaShape',
			'withFiles',
			'removeFiles',
			'mergeFormUnion',
			'splitPath',
			'SuperFormError',
			'SchemaError',
			'intProxy',
			'numberProxy',
			'booleanProxy',
			'dateProxy',
			'stringProxy',
			'fieldProxy',
			'formFieldProxy',
			'arrayProxy',
			'fileProxy',
			'fileFieldProxy',
			'filesProxy',
			'filesFieldProxy',
		] as const;

		it.each(INDEX_SUPERFORMS_EXPORTS)('re-exports %s identically to upstream module', (name) => {
			const formsValue = formsIndex[name as keyof typeof formsIndex];
			const upstreamValue = upstreamAll[name];
			expect(formsValue).toBeDefined();
			expect(formsValue).toBe(upstreamValue);
		});

		it('re-exports local root utilities identically', () => {
			expect(formsIndex.superValidate).toBe(localSuperValidate);
			expect(formsIndex.problemToFieldErrors).toBe(localProblemToFieldErrors);
		});
	});

	describe('src/formsnap.ts re-export surface', () => {
		const FORMSNAP_RUNTIME_EXPORTS = [
			'Field',
			'Control',
			'Label',
			'FieldErrors',
			'Description',
			'Fieldset',
			'Legend',
			'ElementField',
			'useFormField',
			'useFormControl',
			'getFormField',
			'getFormControl',
		] as const;

		const FORMSNAP_TYPE_EXPORTS = ['UseFormFieldProps', 'UseFormControlProps'] as const;

		function extractExportsFromSource(filePath: string): {
			named: string[];
			moduleSpecifier: string;
		}[] {
			const content = readFileSync(filePath, 'utf8');
			const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.ESNext, true);
			const exportsList: { named: string[]; moduleSpecifier: string }[] = [];

			for (const statement of sourceFile.statements) {
				if (ts.isExportDeclaration(statement) && statement.exportClause) {
					const moduleSpec =
						statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
							? statement.moduleSpecifier.text
							: '';
					if (ts.isNamedExports(statement.exportClause)) {
						const names = statement.exportClause.elements.map((el) => el.name.text);
						exportsList.push({ named: names, moduleSpecifier: moduleSpec });
					}
				}
			}
			return exportsList;
		}

		it('re-exports the exact runtime components and hooks from formsnap', () => {
			const formsnapPath = resolve(import.meta.dirname, '../src/formsnap.ts');
			const declarations = extractExportsFromSource(formsnapPath);

			const runtimeDecl = declarations.find(
				(d) => d.moduleSpecifier === 'formsnap' && d.named.includes('Field'),
			);
			expect(runtimeDecl).toBeDefined();

			for (const name of FORMSNAP_RUNTIME_EXPORTS) {
				expect(runtimeDecl?.named).toContain(name);
			}
			expect(runtimeDecl?.named.length).toBe(FORMSNAP_RUNTIME_EXPORTS.length);
		});

		it('re-exports the exact type interfaces from formsnap', () => {
			const formsnapPath = resolve(import.meta.dirname, '../src/formsnap.ts');
			const declarations = extractExportsFromSource(formsnapPath);

			const typeDecl = declarations.find(
				(d) => d.moduleSpecifier === 'formsnap' && d.named.includes('UseFormFieldProps'),
			);
			expect(typeDecl).toBeDefined();

			for (const name of FORMSNAP_TYPE_EXPORTS) {
				expect(typeDecl?.named).toContain(name);
			}
			expect(typeDecl?.named.length).toBe(FORMSNAP_TYPE_EXPORTS.length);
		});
	});
});
