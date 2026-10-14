#!/usr/bin/env node
// Fails if a value that a package exports through package.json `exports` is
// named in none of that package's test files. HISS-15 asks for positive,
// negative and boundary tests per public export; the coverage thresholds only
// prove that lines ran, so an export can ship with no test at all. This check
// holds the first step: every exported value is named in at least one test.
// Whether a test holds all three cases stays a review question.
//
// Exports are read with the TypeScript type checker, so `export *`, renamed
// and upstream re-exports count, and type-only exports do not. A test file is
// any file under test/ or e2e/, or named *.test.* or *.spec.*. A name counts
// when it appears as a whole word.
//
// check-export-tests.test.mjs feeds it fixture packages.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const compilerOptions = {
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	allowImportingTsExtensions: true,
	noEmit: true,
	skipLibCheck: true,
	strict: true,
	types: [],
};

function collectSourceTargets(exportsField) {
	const targets = new Set();
	const walk = (node) => {
		if (typeof node === 'string') {
			if (node.startsWith('./') && /\.(ts|mts)$/.test(node) && !node.endsWith('.d.ts')) {
				targets.add(node);
			}
		} else if (node && typeof node === 'object') {
			for (const value of Object.values(node)) walk(value);
		}
	};
	walk(exportsField);
	return targets;
}

function isValueSymbol(checker, symbol) {
	const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	// An import the compiler cannot resolve (a .svelte component) has no
	// declarations; it is a component at runtime, so it counts as a value.
	if (!target.declarations || target.declarations.length === 0) return true;
	return (target.flags & ts.SymbolFlags.Value) !== 0;
}

async function listFiles(dir) {
	const out = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		let dirents;
		try {
			dirents = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const dirent of dirents) {
			if (dirent.name === 'node_modules' || dirent.name.startsWith('.')) continue;
			const path = join(current, dirent.name);
			if (dirent.isDirectory()) stack.push(path);
			else out.push(path);
		}
	}
	return out;
}

function isTestFile(pkgDir, file) {
	const parts = relative(pkgDir, file).split(sep);
	if (parts[0] === 'test' || parts[0] === 'e2e') return true;
	return /\.(test|spec)\.[cm]?[jt]s$/.test(file);
}

/**
 * Lists every exported value under `packagesDir` that no test file of its own
 * package names.
 *
 * @param {string} packagesDir
 * @returns {Promise<{ checked: number, failures: string[] }>}
 */
export async function findUntestedExports(packagesDir) {
	const failures = [];
	let checked = 0;
	const dirents = await readdir(packagesDir, { withFileTypes: true });
	for (const dirent of dirents) {
		if (!dirent.isDirectory()) continue;
		const pkgDir = join(packagesDir, dirent.name);
		let pkg;
		try {
			pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
		} catch {
			continue;
		}
		if (!pkg.exports) continue;
		const entries = [...collectSourceTargets(pkg.exports)].map((target) => join(pkgDir, target));
		if (entries.length === 0) continue;

		const program = ts.createProgram(entries, compilerOptions);
		const checker = program.getTypeChecker();
		const names = new Map();
		for (const entry of entries) {
			const source = program.getSourceFile(entry);
			const moduleSymbol = source && checker.getSymbolAtLocation(source);
			if (!moduleSymbol) {
				failures.push(`${pkg.name}: cannot read exports of ${relative(pkgDir, entry)}`);
				continue;
			}
			for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
				if (symbol.name === 'default' || !isValueSymbol(checker, symbol)) continue;
				if (!names.has(symbol.name)) names.set(symbol.name, relative(pkgDir, entry));
			}
		}

		const testFiles = (await listFiles(pkgDir)).filter((file) => isTestFile(pkgDir, file));
		const testText = (await Promise.all(testFiles.map((file) => readFile(file, 'utf8')))).join(
			'\n',
		);
		for (const [name, entry] of names) {
			checked += 1;
			const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			if (!new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(testText)) {
				failures.push(`${pkg.name}: ${name} (exported from ${entry}) is named in no test file`);
			}
		}
	}
	return { checked, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const { checked, failures } = await findUntestedExports(join(root, 'packages'));
	if (failures.length > 0) {
		console.error(`Exported values no test names (${failures.length} of ${checked}):`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
	}
	console.log(`OK: each of ${checked} exported values is named in a test of its package.`);
}
