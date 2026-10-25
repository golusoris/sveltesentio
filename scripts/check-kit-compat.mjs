#!/usr/bin/env node
// Type-checks every package that declares a `@sveltejs/kit` peer against
// SvelteKit 3 (peer range `^3.0.0`, ADR-0058).
//
// The packages ship their TypeScript source as their types, so a consumer's
// compiler reads it with the consumer's SvelteKit. `skipLibCheck` does not skip
// `.ts` files: a name one major does not export is a hard error in the
// consumer's build. That is how `import type { Handle } from '@sveltejs/kit'`
// broke under SvelteKit 3, which exports the hook types from
// `@sveltejs/kit/hooks` only.
//
// Each package is checked with its own `tsconfig.test.json`,
// with every `@sveltejs/kit` specifier mapped to that major's type bundle. The
// bundle declares `@sveltejs/kit` and its subpaths as ambient modules, so the
// mapping only has to bring the right file into the program.
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const KIT = '@sveltejs/kit';
const KIT_TYPES = join('types', 'index.d.ts');
const KIT_TYPES_SUFFIX = `/${KIT}/${KIT_TYPES}`;

// SvelteKit 3 is the workspace's own devDependency.
export const KIT_INSTALLS = [
	{ major: 3, dir: join(root, 'packages', 'core', 'node_modules', '@sveltejs', 'kit') },
];

/**
 * Reads one SvelteKit install and refuses anything but the expected major, so a
 * moved alias or a bumped devDependency cannot turn the check into two runs
 * against the same major.
 */
export async function readKit({ major, dir }) {
	const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
	if (manifest.name !== KIT) {
		throw new Error(`${dir} holds ${manifest.name}, expected ${KIT}`);
	}
	if (Number.parseInt(manifest.version, 10) !== major) {
		throw new Error(`${dir} holds ${KIT} ${manifest.version}, expected major ${major}`);
	}
	return { version: manifest.version, types: realpathSync(join(dir, KIT_TYPES)) };
}

/** Names of the directories under `packagesDir` whose package declares a `@sveltejs/kit` peer. */
export async function kitPeerPackages(packagesDir) {
	const names = [];
	const dirents = await readdir(packagesDir, { withFileTypes: true });
	for (const dirent of dirents) {
		if (!dirent.isDirectory()) continue;
		let manifest;
		try {
			manifest = JSON.parse(await readFile(join(packagesDir, dirent.name, 'package.json'), 'utf8'));
		} catch {
			continue;
		}
		if (manifest.peerDependencies?.[KIT]) names.push(dirent.name);
	}
	return names.sort();
}

function describe(ts, diagnostic) {
	const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
	if (!diagnostic.file || diagnostic.start === undefined) return `TS${diagnostic.code} ${text}`;
	const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
	return `TS${diagnostic.code} ${diagnostic.file.fileName}:${line + 1} ${text}`;
}

/** SvelteKit type bundles in the program other than the one the check mapped. */
function strayKitBundles(program, kitTypes) {
	return program
		.getSourceFiles()
		.map((file) => realpathSync(file.fileName))
		.filter((file) => file.endsWith(KIT_TYPES_SUFFIX) && file !== kitTypes);
}

/**
 * Type-checks the project at `configPath` with every `@sveltejs/kit` specifier
 * mapped to `kitTypes`. Returns one line per finding; an empty list is a pass.
 *
 * A second SvelteKit type bundle in the program is a finding of its own: both
 * bundles declare the same ambient modules, the declarations merge, and a name
 * only one major exports would resolve.
 */
export function typeErrors(ts, configPath, kitTypes) {
	const configErrors = [];
	const host = {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: (diagnostic) => configErrors.push(diagnostic),
	};
	const mapped = { paths: { [KIT]: [kitTypes], [`${KIT}/*`]: [kitTypes] } };
	const parsed = ts.getParsedCommandLineOfConfigFile(configPath, mapped, host);
	if (!parsed) return configErrors.map((diagnostic) => describe(ts, diagnostic));

	const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
	const findings = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) =>
		describe(ts, diagnostic),
	);
	for (const stray of strayKitBundles(program, kitTypes)) {
		findings.push(`a second ${KIT} type bundle is in the program: ${stray}`);
	}
	return findings;
}

async function main() {
	const ts = createRequire(join(root, 'package.json'))('typescript');
	const packagesDir = join(root, 'packages');
	const packages = await kitPeerPackages(packagesDir);
	if (packages.length === 0) {
		console.error(`No package under ${packagesDir} declares a ${KIT} peer.`);
		process.exit(1);
	}

	let failed = false;
	for (const install of KIT_INSTALLS) {
		const kit = await readKit(install);
		for (const name of packages) {
			const findings = typeErrors(ts, join(packagesDir, name, 'tsconfig.test.json'), kit.types);
			if (findings.length === 0) continue;
			failed = true;
			console.error(`${KIT} ${kit.version}, packages/${name}: ${findings.length} finding(s)`);
			for (const finding of findings) console.error(`  - ${finding}`);
		}
		console.log(`${KIT} ${kit.version}: checked ${packages.join(', ')} (TypeScript ${ts.version})`);
	}

	if (failed) process.exit(1);
	console.log(`OK: every package with a ${KIT} peer type-checks against SvelteKit 3.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
