#!/usr/bin/env node
// Fails if any packages/*/package.json `exports` or `bin` target points at a file
// that does not exist on disk, or if a `bin` target does not end in
// .js/.mjs/.cjs (Node will not strip types under node_modules). Guards the
// class of bug in #66 (ui ./presets, ./tokens) and #66's note about ai ./edge.
//
// check-export-targets.test.mjs feeds it fixture packages with missing or invalid targets.
import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function collectTargets(exportsField) {
	const targets = new Set();
	const walk = (node) => {
		if (typeof node === 'string') {
			if (node.startsWith('./')) targets.add(node);
		} else if (node && typeof node === 'object') {
			for (const value of Object.values(node)) walk(value);
		}
	};
	walk(exportsField);
	return targets;
}

function collectBinTargets(binField) {
	if (typeof binField === 'string') return [binField];
	if (binField && typeof binField === 'object') {
		return Object.values(binField).filter((v) => typeof v === 'string');
	}
	return [];
}

function hasJsExtension(target) {
	return target.endsWith('.js') || target.endsWith('.mjs') || target.endsWith('.cjs');
}

async function checkExports(pkgName, pkgDir, exportsField) {
	const failures = [];
	if (!exportsField) return failures;
	for (const target of collectTargets(exportsField)) {
		try {
			await access(join(pkgDir, target));
		} catch {
			failures.push(`${pkgName}: export target "${target}" does not exist`);
		}
	}
	return failures;
}

async function checkBin(pkgName, pkgDir, binField) {
	const failures = [];
	for (const target of collectBinTargets(binField)) {
		if (!hasJsExtension(target)) {
			failures.push(
				`${pkgName}: bin target "${target}" does not end in .js/.mjs/.cjs (Node will not strip types under node_modules)`,
			);
		}
		try {
			await access(join(pkgDir, target));
		} catch {
			failures.push(`${pkgName}: bin target "${target}" does not exist`);
		}
	}
	return failures;
}

/**
 * Lists every exports and bin target under `packagesDir` that does not exist on disk
 * or has an invalid bin extension.
 *
 * @param {string} packagesDir
 * @returns {Promise<string[]>}
 */
export async function findMissingTargets(packagesDir) {
	const failures = [];
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
		const exportFailures = await checkExports(pkg.name, pkgDir, pkg.exports);
		const binFailures = await checkBin(pkg.name, pkgDir, pkg.bin);
		failures.push(...exportFailures, ...binFailures);
	}
	return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const failures = await findMissingTargets(join(root, 'packages'));
	if (failures.length > 0) {
		console.error('Missing package export targets:');
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
	}
	console.log('OK: every package.json export target resolves to a real file.');
}
