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

/** Returns parsed `package.json` in `pkgDir`, or `undefined` when missing or invalid JSON. */
async function readPackageManifest(pkgDir) {
	try {
		return JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
	} catch {
		return undefined;
	}
}

/** Records non-default value export names from `moduleSymbol` into `names` (returns nothing). */
function collectEntryValueExports(checker, moduleSymbol, entryRel, names) {
	for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
		if (symbol.name === 'default' || !isValueSymbol(checker, symbol)) continue;
		if (!names.has(symbol.name)) names.set(symbol.name, entryRel);
	}
}

/** Returns value export names across `entries` and failures for unreadable entry modules. */
function collectPackageExports(pkgDir, pkgName, entries) {
	const program = ts.createProgram(entries, compilerOptions);
	const checker = program.getTypeChecker();
	const names = new Map();
	const entryFailures = [];

	for (const entry of entries) {
		const entryRel = relative(pkgDir, entry);
		const source = program.getSourceFile(entry);
		const moduleSymbol = source ? checker.getSymbolAtLocation(source) : undefined;
		if (!moduleSymbol) {
			entryFailures.push(`${pkgName}: cannot read exports of ${entryRel}`);
			continue;
		}
		collectEntryValueExports(checker, moduleSymbol, entryRel, names);
	}
	return { names, entryFailures };
}

/** Returns the newline-joined contents of every test file inside `pkgDir`. */
async function readPackageTestText(pkgDir) {
	const testFiles = (await listFiles(pkgDir)).filter((file) => isTestFile(pkgDir, file));
	const contents = await Promise.all(testFiles.map((file) => readFile(file, 'utf8')));
	return contents.join('\n');
}

/** Returns whether identifier `name` appears as a whole word in `testText`. */
function isNamedInTests(name, testText) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(testText);
}

/** Returns `{ checked, failures }` for exported values of a single package in `pkgDir`. */
async function checkPackageExportTests(pkgDir) {
	const pkg = await readPackageManifest(pkgDir);
	if (!pkg?.exports) return { checked: 0, failures: [] };

	const entries = [...collectSourceTargets(pkg.exports)].map((target) => join(pkgDir, target));
	if (entries.length === 0) return { checked: 0, failures: [] };

	const { names, entryFailures } = collectPackageExports(pkgDir, pkg.name, entries);
	const failures = [...entryFailures];
	const testText = await readPackageTestText(pkgDir);

	for (const [name, entry] of names) {
		if (!isNamedInTests(name, testText)) {
			failures.push(`${pkg.name}: ${name} (exported from ${entry}) is named in no test file`);
		}
	}
	return { checked: names.size, failures };
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
		const result = await checkPackageExportTests(join(packagesDir, dirent.name));
		checked += result.checked;
		failures.push(...result.failures);
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
