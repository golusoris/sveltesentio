#!/usr/bin/env node
// Fails if an archive this workspace would publish lacks the licence text, the
// repository field, the Node engine, the TypeScript peer, the floor of another
// peer or the copyright line.
//
// The six reach an archive by different routes, and none of them is visible
// in the tree alone:
//   - the licence text is not in any package folder. `pnpm pack`, the packer
//     behind the release workflow's `pnpm -r publish`, copies the root LICENSE
//     into every archive. `npm pack` does not, so the packer matters;
//   - the `repository` field is what tells a consumer where the source lives,
//     and the registry refuses a provenance statement whose source repository
//     differs from it (compared case-sensitively);
//   - engines.node is declared once in the root package.json, and every
//     published manifest repeats it (ADR-0021);
//   - the TypeScript peer range is fixed by ADR-0020, and every published
//     manifest declares it as a required peer: consumers typecheck the
//     published source, so the range is the promise that it compiles;
//   - a package that declares a svelte, @sveltejs/kit or vite peer declares the
//     measured floor: the lowest version the packages typecheck and test
//     against, and below which their own dependencies refuse to install;
//   - the EUPL text names no licensor, so the copyright line in the package
//     README is the only notice that travels with the archive.
//
// The check therefore packs the workspace with the real packer into a temporary
// directory and reads the archives, instead of reading manifests in the tree.
// A package marked `private` is never published and is skipped.
//
// The address is declared once, in the root package.json `repository` field.
// Every published manifest must repeat it and add its own `directory`.
//
// `pnpm test:scripts` runs it: the last test in check-package-archives.test.mjs
// packs this repository. Run this file directly for the list of findings.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The licensor, as REUSE.toml names the copyright holder of the tree. */
export const LICENSOR = 'lusoris';

/** The published TypeScript peer range, as ADR-0020 states it. */
export const TYPESCRIPT_PEER = '>=5.5 <7';

/**
 * The range of every other floored peer, for the packages that declare it.
 * svelte: sveltekit-superforms 3 declares ^5.56.4, and layerchart 2.6.1 fails
 * its tests on 5.56.3. @sveltejs/kit: floor 3.0.0 = first kit 3, 0 advisories,
 * measured 2026-10-25. vite: lowest release with no advisory in the GitHub
 * advisory database; 8.0.15 is affected by GHSA-v6wh-96g9-6wx3 and
 * GHSA-fx2h-pf6j-xcff.
 */
export const PEER_RANGES = Object.freeze({
	svelte: '>=5.56.4',
	'@sveltejs/kit': '^3.0.0',
	vite: '>=8.0.16',
});

const BLOCK = 512;

// Upper bounds (HISS-02). The largest archive here holds about 150 entries and
// the workspace about 25 packages; running into a bound is an error, not a
// truncated result.
const ENTRY_LIMIT = 10_000;
const ARCHIVE_LIMIT = 200;
const PACK_DEADLINE_MS = 180_000;

function field(header, start, length) {
	const raw = header.subarray(start, start + length);
	const end = raw.indexOf(0);
	return raw.toString('utf8', 0, end === -1 ? length : end);
}

/**
 * Reads the regular files of a gzipped tar archive into a map of path to bytes.
 * Only the classic header fields are read; a path longer than they hold (a pax
 * record) is not one of the three this check looks up.
 */
export function readArchive(gzipped) {
	const tar = gunzipSync(gzipped);
	const files = new Map();
	let offset = 0;
	for (let count = 0; offset + BLOCK <= tar.length; count += 1) {
		if (count >= ENTRY_LIMIT) throw new Error(`archive holds more than ${ENTRY_LIMIT} entries`);
		const header = tar.subarray(offset, offset + BLOCK);
		if (header.every((byte) => byte === 0)) break;
		const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
		const body = offset + BLOCK;
		if (!Number.isInteger(size) || size < 0 || body + size > tar.length) {
			throw new Error(`archive entry at byte ${offset} has no readable size`);
		}
		const prefix = field(header, 345, 155);
		const name = field(header, 0, 100);
		const type = header[156];
		if (type === 0 || type === 0x30) {
			files.set(prefix ? `${prefix}/${name}` : name, tar.subarray(body, body + size));
		}
		offset = body + Math.ceil(size / BLOCK) * BLOCK;
	}
	return files;
}

function licenceGaps(files, expected) {
	const licence = files.get('package/LICENSE');
	if (!licence) return ['no LICENSE file in the archive'];
	if (!licence.equals(expected.licence)) return ['LICENSE differs from the root LICENSE'];
	return [];
}

function repositoryGaps(manifest, expected) {
	const repository = manifest.repository;
	if (repository === null || typeof repository !== 'object') {
		return ['package.json has no repository object'];
	}
	const gaps = [];
	if (repository.type !== 'git') gaps.push('repository.type is not "git"');
	if (repository.url !== expected.url) {
		gaps.push(`repository.url is ${JSON.stringify(repository.url)}, expected "${expected.url}"`);
	}
	const directory = expected.directories.get(manifest.name);
	if (repository.directory !== directory) {
		gaps.push(
			`repository.directory is ${JSON.stringify(repository.directory)}, expected "${directory}"`,
		);
	}
	return gaps;
}

function enginesGaps(manifest, expected) {
	if (manifest.engines?.node !== expected.node) {
		return [
			`engines.node is ${JSON.stringify(manifest.engines?.node)}, expected "${expected.node}"`,
		];
	}
	return [];
}

function typescriptPeerGaps(manifest, expected) {
	const range = manifest.peerDependencies?.typescript;
	const gaps = [];
	if (range !== expected.typescript) {
		gaps.push(
			`peerDependencies.typescript is ${JSON.stringify(range)}, expected "${expected.typescript}"`,
		);
	}
	if (manifest.peerDependenciesMeta?.typescript?.optional === true) {
		gaps.push('peerDependenciesMeta marks typescript optional');
	}
	return gaps;
}

function peerRangeGaps(manifest, expected) {
	const gaps = [];
	for (const [name, range] of Object.entries(expected.peers)) {
		const declared = manifest.peerDependencies?.[name];
		if (declared !== undefined && declared !== range) {
			gaps.push(`peerDependencies.${name} is ${JSON.stringify(declared)}, expected "${range}"`);
		}
	}
	return gaps;
}

function noticeGaps(files, expected) {
	const notice = `${expected.license} © ${LICENSOR}`;
	const readme = files.get('package/README.md')?.toString('utf8') ?? '';
	const lines = readme.split(/\r?\n/).filter((line) => line.startsWith(notice));
	return lines.length === 1 ? [] : [`README.md has ${lines.length} lines starting "${notice}"`];
}

/**
 * What one archive lacks. `files` is the map `readArchive` returns; `expected`
 * holds the root `licence` bytes, the `license` identifier, the repository
 * `url`, the Node engine `node`, the TypeScript peer range `typescript`, the
 * `peers` map of peer name to range and the `directories` map of package name to workspace folder.
 *
 * Returns `{ name, published, gaps }`. A private package is not published and
 * has no gaps by definition.
 */
export function archiveGaps(files, expected) {
	const source = files.get('package/package.json');
	if (!source) return { name: '(unknown)', published: true, gaps: ['no package.json'] };
	const manifest = JSON.parse(source.toString('utf8'));
	if (manifest.private === true) return { name: manifest.name, published: false, gaps: [] };

	const gaps = [...licenceGaps(files, expected)];
	if (manifest.license !== expected.license) {
		gaps.push(`license is ${JSON.stringify(manifest.license)}, expected "${expected.license}"`);
	}
	gaps.push(
		...repositoryGaps(manifest, expected),
		...enginesGaps(manifest, expected),
		...typescriptPeerGaps(manifest, expected),
		...peerRangeGaps(manifest, expected),
		...noticeGaps(files, expected),
	);
	return { name: manifest.name, published: true, gaps };
}

/** Reads what the archives are compared against from the workspace at `dir`. */
export async function readExpected(dir) {
	const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
	if (
		typeof manifest.repository?.url !== 'string' ||
		typeof manifest.license !== 'string' ||
		typeof manifest.engines?.node !== 'string'
	) {
		throw new Error('the root package.json needs a license, a repository.url and an engines.node');
	}
	const entries = await readdir(join(dir, 'packages'), { withFileTypes: true });
	if (entries.length > ARCHIVE_LIMIT) {
		throw new Error(`packages/ holds more than ${ARCHIVE_LIMIT} entries`);
	}
	const directories = new Map();
	for (const entry of entries.filter((dirent) => dirent.isDirectory())) {
		const path = join(dir, 'packages', entry.name, 'package.json');
		const { name } = JSON.parse(await readFile(path, 'utf8'));
		directories.set(name, `packages/${entry.name}`);
	}
	return {
		licence: await readFile(join(dir, 'LICENSE')),
		license: manifest.license,
		url: manifest.repository.url,
		node: manifest.engines.node,
		typescript: TYPESCRIPT_PEER,
		peers: PEER_RANGES,
		directories,
	};
}

/** Packs every workspace package of `dir` into `destination` with pnpm. */
export async function packWorkspace(dir, destination) {
	await promisify(execFile)('pnpm', ['-r', 'pack', '--pack-destination', destination], {
		cwd: dir,
		timeout: PACK_DEADLINE_MS,
		maxBuffer: 16 * 1024 * 1024,
		// pnpm is a .cmd shim on Windows, which only a shell can start.
		shell: process.platform === 'win32',
	});
}

/** Reads every archive in `folder` and returns one result per archive. */
export async function scanArchives(folder, expected) {
	const names = (await readdir(folder)).filter((name) => name.endsWith('.tgz')).sort();
	if (names.length > ARCHIVE_LIMIT) {
		throw new Error(`${folder} holds more than ${ARCHIVE_LIMIT} archives`);
	}
	const results = [];
	for (const name of names) {
		const files = readArchive(await readFile(join(folder, name)));
		results.push({ archive: name, ...archiveGaps(files, expected) });
	}
	return results;
}

/** Returns the exit code: 0 when archives were read and none lacks anything. */
export async function main(dir = root, pack = packWorkspace) {
	const expected = await readExpected(dir);
	const destination = await mkdtemp(join(tmpdir(), 'package-archives-'));
	let results;
	try {
		await pack(dir, destination);
		results = await scanArchives(destination, expected);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}

	const published = results.filter((result) => result.published);
	const missing = [...expected.directories.keys()].filter(
		(name) => !results.some((result) => result.name === name),
	);
	if (published.length === 0 || missing.length > 0) {
		console.error(`Archives read: ${results.length}. No archive for: ${missing.join(', ')}.`);
		return 1;
	}
	const failed = published.filter((result) => result.gaps.length > 0);
	for (const { archive, gaps } of failed) {
		console.error(`${archive}:`);
		for (const gap of gaps) console.error(`  - ${gap}`);
	}
	if (failed.length > 0) {
		console.error(`\n${failed.length} of ${published.length} published archives lack something.`);
		return 1;
	}
	console.log(
		`OK: ${published.length} published archives carry the licence text, the repository field, the Node engine, the TypeScript peer, the peer floors and the copyright line.`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
