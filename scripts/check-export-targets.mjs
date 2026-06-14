#!/usr/bin/env node
// Fails if any packages/*/package.json `exports` target points at a file that
// does not exist on disk. Guards the class of bug in #66 (ui ./presets, ./tokens)
// and #66's note about ai ./edge — a missing target is a hard module-resolution
// error for downstream consumers and breaks adoption probes.
import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const packagesDir = join(root, 'packages');

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
	if (!pkg.exports) continue;
	for (const target of collectTargets(pkg.exports)) {
		try {
			await access(join(pkgDir, target));
		} catch {
			failures.push(`${pkg.name}: export target "${target}" does not exist`);
		}
	}
}

if (failures.length > 0) {
	console.error('Missing package export targets:');
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log('OK: every package.json export target resolves to a real file.');
