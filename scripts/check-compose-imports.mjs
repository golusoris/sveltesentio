#!/usr/bin/env node
// Fails if a recipe under docs/compose imports an app module in a form that
// SvelteKit 3 or TypeScript refuses.
//
// The recipes import the app's own modules through `#lib`, a subpath import
// the app declares in its package.json (docs/compose/README.md, "Importing
// from `src/lib`"). Two forms break a consumer who copies a recipe:
//   - the alias SvelteKit 3 removed: a build that imports through it stops
//     with `module_removed_lib`. It is refused anywhere in a recipe, prose
//     included, so a reader is not told to use it either;
//   - a `#lib` specifier without a file extension, or ending in `.ts`:
//     TypeScript applies no extension or index lookup to a wildcard subpath
//     import, so `#lib/api/client` fails the type check where
//     `#lib/api/client.js` passes.
//
// Specifiers are read only where a module is imported: after `from`,
// `import`, `import(` and `vi.mock(`. A `#lib` value in a configuration
// block, such as a components.json alias, names a directory and is not read.
// A specifier with a `...` placeholder stands for a generated path and is
// accepted.
//
// `pnpm test:scripts` runs it: the last test in check-compose-imports.test.mjs
// reads this repository's recipes. Run this file directly for the list of lines.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const composeDir = join(root, 'docs', 'compose');

/** The removed alias as a whole token; `$library` is a name of its own. */
const REMOVED_ALIAS = /\$lib(?![\w$])/;

/** A `#lib` specifier in an import context, with its quote. */
const IMPORT_SPECIFIER =
	/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*)(['"`])(#lib(?:\/[^'"`]*)?)\1/g;

/** Extensions a `#lib` specifier may end in: compiled `.js`, or a file Vite reads as is. */
const ACCEPTED_END = /\.(?:js|svelte|md|json|css|svg|png|jpg|webp)(?:\?[^/]*)?$/;

// Upper bound on the directory entries one scan reads (HISS-02). The directory
// holds about ninety recipes; running into the bound is an error, not a
// truncated result.
const ENTRY_LIMIT = 1_000;

/** Why a `#lib` specifier is refused, or null when it is accepted. */
export function specifierProblem(specifier) {
	if (specifier === '#lib' || specifier.includes('...')) return null;
	if (ACCEPTED_END.test(specifier)) return null;
	if (specifier.endsWith('.ts')) return 'ends in .ts; import the compiled name, .js';
	return 'has no file extension; add .js, or /index.js for a directory';
}

/** Lines of one recipe that use the removed alias or a refused `#lib` specifier. */
export function findImportProblems(source) {
	const findings = [];
	for (const [index, text] of source.split(/\r?\n/).entries()) {
		const line = index + 1;
		if (REMOVED_ALIAS.test(text)) {
			findings.push({
				line,
				problem: 'names the alias SvelteKit 3 removed; use #lib',
				text: text.trim(),
			});
		}
		for (const match of text.matchAll(IMPORT_SPECIFIER)) {
			const problem = specifierProblem(match[2]);
			if (problem) findings.push({ line, problem: `${match[2]} ${problem}`, text: text.trim() });
		}
	}
	return findings;
}

/** Reads every recipe in `dir` and returns what was read and what was found. */
export async function scanRecipes(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	if (entries.length > ENTRY_LIMIT) {
		throw new Error(`${dir} holds more than ${ENTRY_LIMIT} entries`);
	}
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
		.map((entry) => entry.name)
		.sort();

	const findings = [];
	for (const file of files) {
		const source = await readFile(join(dir, file), 'utf8');
		for (const finding of findImportProblems(source)) findings.push({ file, ...finding });
	}
	return { files, findings };
}

/** Returns the exit code: 0 when recipes were read and every import is accepted. */
export async function main(dir = composeDir) {
	const { files, findings } = await scanRecipes(dir);
	const where = relative(root, dir);

	if (files.length === 0) {
		console.error(`No recipe found in ${where}; nothing was checked.`);
		return 1;
	}
	if (findings.length > 0) {
		console.error(`${findings.length} import problems in ${where}:\n`);
		for (const { file, line, problem } of findings) console.error(`  ${file}:${line}: ${problem}`);
		console.error(
			`\nThe accepted forms are listed in ${where}/README.md, "Importing from src/lib".`,
		);
		return 1;
	}
	console.log(`OK: the ${files.length} files in ${where} import app modules through #lib only.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
