#!/usr/bin/env node
// Pins the workspace to the lowest release of every peer range the packages
// declare, so CI can run the packages against the floor they promise.
//
// The lockfile CI installs the newest release inside each range, which proves
// the upper end only. A package can use an API newer than its declared floor
// and still pass there; consumers on the floor then get a broken build. This
// script reads the ranges from the published manifests, asks the registry for
// the lowest release inside each range, and writes them as pnpm overrides.
//
//   node scripts/pin-peer-floors.mjs           write the overrides
//   node scripts/pin-peer-floors.mjs --verify  check the installed versions
//
// The registry resolves the range (`npm view <name>@<range> version`), so the
// range semantics are npm's own, not a copy. Prereleases never satisfy a plain
// range there. TypeScript has no 5.5.0 on the registry; the lowest release of
// the ADR-0020 range ">=5.5 <7" is 5.5.2, and the log says so.
//
// The peer-floors workflow runs it weekly and on the release pull request.
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import semver from 'semver';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The peers pinned to their floor. Each must be declared with one range. */
export const FLOORED_PEERS = Object.freeze(['svelte', '@sveltejs/kit', 'vite', 'typescript']);

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const OVERRIDES_LINE = 'overrides:';

// Upper bounds (HISS-02). The workspace holds about 25 packages and the
// registry lists a few hundred releases per peer.
const PACKAGE_LIMIT = 200;
export const RELEASE_LIMIT = 5_000;
const VIEW_DEADLINE_MS = 60_000;

/**
 * The range each floored peer is declared with, from the package manifests.
 * Returns the ranges and every disagreement: two packages with two ranges for
 * one peer have two floors, and one run cannot test both.
 */
export function collectRanges(manifests, peers = FLOORED_PEERS) {
	const ranges = new Map();
	const conflicts = [];
	for (const { name, peerDependencies = {} } of manifests) {
		for (const peer of peers) {
			const range = peerDependencies[peer];
			if (range === undefined) continue;
			const seen = ranges.get(peer);
			if (seen === undefined) ranges.set(peer, { range, from: name });
			else if (seen.range !== range) {
				conflicts.push(
					`${peer}: ${seen.from} declares "${seen.range}", ${name} declares "${range}"`,
				);
			}
		}
	}
	return { ranges, conflicts };
}

/**
 * The lowest release in the list the registry returned for a range. Anything
 * that is not a plain `major.minor.patch` is refused, not skipped: a
 * prerelease or a tag here means the range matched something it should not.
 */
export function lowestRelease(versions) {
	const list = typeof versions === 'string' ? [versions] : versions;
	if (!Array.isArray(list) || list.length === 0) throw new Error('the range matches no release');
	if (list.length > RELEASE_LIMIT) throw new Error(`more than ${RELEASE_LIMIT} releases`);
	const odd = list.filter(
		(version) =>
			typeof version !== 'string' ||
			semver.valid(version) !== version ||
			semver.prerelease(version) !== null,
	);
	if (odd.length > 0) throw new Error(`not a plain release: ${odd.join(', ')}`);
	return semver.sort([...list])[0];
}

/**
 * The workspace file with one override per floor added under `overrides:`.
 * An override the file already holds for a floored peer is an error: the
 * floor would silently lose to it, or the YAML would hold the key twice.
 */
export function withOverrides(text, floors) {
	const lines = text.split('\n');
	const at = lines.flatMap((line, index) => (line === OVERRIDES_LINE ? [index] : []));
	if (at.length !== 1) throw new Error(`expected one "${OVERRIDES_LINE}" line, found ${at.length}`);
	const pinned = [...floors.keys()];
	const clash = lines.filter((line) => pinned.some((peer) => overrideKey(line) === peer));
	if (clash.length > 0)
		throw new Error(`already overridden: ${clash.map((line) => line.trim()).join(', ')}`);
	const added = [...floors].map(([peer, version]) => `  '${peer}': ${version}`);
	lines.splice(at[0] + 1, 0, ...added);
	return lines.join('\n');
}

function overrideKey(line) {
	const match = /^ {2}'?([^':\s]+)'?:/.exec(line);
	return match?.[1];
}

/**
 * Every package that declares a floored peer, with the version installed for
 * it and the floor it should have. An empty list means the install honoured
 * every floor.
 */
export function installedGaps(installed, floors) {
	return installed
		.filter(({ peer, version }) => floors.has(peer) && version !== floors.get(peer))
		.map(
			({ name, peer, version }) =>
				`${name}: ${peer} ${version ?? 'not installed'}, floor ${floors.get(peer)}`,
		);
}

async function readManifests(dir) {
	const entries = await readdir(join(dir, 'packages'), { withFileTypes: true });
	if (entries.length > PACKAGE_LIMIT) throw new Error(`more than ${PACKAGE_LIMIT} packages`);
	const manifests = [];
	for (const entry of entries.filter((item) => item.isDirectory())) {
		const folder = join(dir, 'packages', entry.name);
		const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
		if (manifest.private !== true) manifests.push({ ...manifest, folder });
	}
	return manifests;
}

async function viewRange(peer, range) {
	const { stdout } = await promisify(execFile)(
		'npm',
		['view', `${peer}@${range}`, 'version', '--json'],
		{
			timeout: VIEW_DEADLINE_MS,
			maxBuffer: 4 * 1024 * 1024,
		},
	);
	return JSON.parse(stdout);
}

async function readFloors(dir, view) {
	const { ranges, conflicts } = collectRanges(await readManifests(dir));
	if (conflicts.length > 0) throw new Error(`peer ranges disagree:\n  ${conflicts.join('\n  ')}`);
	const floors = new Map();
	for (const [peer, { range }] of ranges) {
		const floor = lowestRelease(await view(peer, range));
		console.log(`${peer} "${range}" -> ${floor}`);
		floors.set(peer, floor);
	}
	return floors;
}

// The package's own node_modules first, then the workspace root: the folders
// Node searches from a package in this tree.
async function installedVersion(dir, folder, peer) {
	for (const base of [folder, dir]) {
		try {
			const manifest = JSON.parse(
				await readFile(join(base, 'node_modules', peer, 'package.json'), 'utf8'),
			);
			return manifest.version;
		} catch (error) {
			if (error.code !== 'ENOENT') throw new Error(`reading ${peer} in ${base}`, { cause: error });
		}
	}
	return undefined;
}

export async function main(argv = process.argv.slice(2), dir = root, view = viewRange) {
	const floors = await readFloors(dir, view);
	if (!argv.includes('--verify')) {
		const file = join(dir, WORKSPACE_FILE);
		await writeFile(file, withOverrides(await readFile(file, 'utf8'), floors));
		console.log(`Wrote ${floors.size} overrides to ${WORKSPACE_FILE}.`);
		return 0;
	}
	const installed = [];
	for (const { name, folder, peerDependencies = {} } of await readManifests(dir)) {
		for (const peer of Object.keys(peerDependencies).filter((item) => floors.has(item))) {
			installed.push({ name, peer, version: await installedVersion(dir, folder, peer) });
		}
	}
	const gaps = installedGaps(installed, floors);
	for (const gap of gaps) console.error(`  - ${gap}`);
	if (gaps.length > 0) return 1;
	console.log(`OK: ${installed.length} declared peers installed at their floor.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
