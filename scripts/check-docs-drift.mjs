#!/usr/bin/env node
/**
 * Fails when a package changes the set of entry points it publishes without
 * touching its README.
 *
 * The mechanism is backported from praetor's `scripts/docs_drift.py`
 * (cordanaLLM/praetor#87), which took it from VMAFx/vmafx. The design is
 * theirs; what counts as a surface here is this repository's own.
 *
 * Praetor hand-lists its surfaces. That does not transfer: this repository
 * publishes 19 packages with 317 export targets between them, and a hand-kept
 * list of that size is a second thing to drift. The surface is therefore
 * derived — every key of every `packages/*‍/package.json` `exports` map.
 *
 * What is deliberately NOT a surface:
 *
 *   - The *contents* of an exported file. A bug fix in `core/src/http.ts` is
 *     not a documentation event, and demanding a README edit for one would
 *     make the check fire on nearly every pull request. An accusation is only
 *     worth reading if it is rare.
 *   - `package.json` as a whole. Renovate and release-please rewrite those
 *     files constantly; keying on the file would accuse on every dependency
 *     bump and every release. Only the `exports` key set is compared, parsed
 *     from both revisions.
 *
 * What remains — a subpath appearing, disappearing or being renamed — is
 * exactly the change a consumer discovers by their import breaking, and it is
 * rare: across the last 80 first-parent commits, 12 of the 42 that touched
 * `packages/` changed an export key set. All 12 shipped without a README edit,
 * which is why this check exists.
 *
 * An ADR does not satisfy the check. Praetor's reasoning holds here: an ADR
 * records a decision, while a README describes a surface, and letting one
 * stand in for the other would reduce the requirement to "it was written down
 * somewhere".
 *
 * Escape hatch: put `no docs needed: <reason>` in the pull request body.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Bounded so a pathological diff cannot make the check unbounded (HISS-02).
export const MAX_DIFF_FILES = 5000;

export const OPT_OUT = /no docs needed[: ]/i;

/**
 * Parses the `exports` key set from a package manifest.
 *
 * A manifest that is absent or unparseable yields null rather than an empty
 * set, so that "added in this change" and "exports nothing" stay distinct.
 *
 * @param {string | null} manifestSource
 * @returns {Set<string> | null}
 */
export function exportKeys(manifestSource) {
	if (manifestSource === null || manifestSource.trim() === '') return null;
	let parsed;
	try {
		parsed = JSON.parse(manifestSource);
	} catch {
		return null;
	}
	const exportsField = parsed?.exports;
	if (exportsField === undefined || exportsField === null) return new Set();
	if (typeof exportsField === 'string') return new Set(['.']);
	return new Set(Object.keys(exportsField));
}

/**
 * Compares two key sets.
 *
 * @param {Set<string> | null} before
 * @param {Set<string> | null} after
 * @returns {{added: string[], removed: string[]}}
 */
export function diffKeys(before, after) {
	// A package that did not exist on either side contributes no surface change:
	// an added package is documented by its own new README, and a deleted one has
	// no README left to update.
	if (before === null || after === null) return { added: [], removed: [] };
	const added = [...after].filter((key) => !before.has(key)).sort();
	const removed = [...before].filter((key) => !after.has(key)).sort();
	return { added, removed };
}

/**
 * Builds the list of accusations.
 *
 * @param {Array<{name: string, readme: string, added: string[], removed: string[]}>} surfaceChanges
 * @param {string[]} changedFiles
 * @returns {string[]}
 */
export function findDrift(surfaceChanges, changedFiles) {
	const touched = new Set(changedFiles);
	const found = [];
	for (const change of surfaceChanges) {
		if (change.added.length === 0 && change.removed.length === 0) continue;
		if (touched.has(change.readme)) continue;
		const parts = [];
		if (change.added.length > 0) parts.push(`added ${change.added.join(', ')}`);
		if (change.removed.length > 0) parts.push(`removed ${change.removed.join(', ')}`);
		found.push(`${change.name}: ${parts.join('; ')} with no edit to ${change.readme}`);
	}
	return found;
}

/**
 * Reads a file at a git revision, returning null when it does not exist there.
 *
 * @param {string} ref
 * @param {string} path
 * @returns {string | null}
 */
function showAtRef(ref, path) {
	try {
		return execFileSync('git', ['show', `${ref}:${path}`], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'ignore'],
			maxBuffer: 8 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

/**
 * Lists the files changed between two revisions, bounded by MAX_DIFF_FILES.
 *
 * @param {string} base
 * @param {string} head
 * @returns {string[]}
 */
function changedFilesBetween(base, head) {
	const out = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	});
	return out
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, MAX_DIFF_FILES);
}

/** Collects every package directory that exists at either revision. */
function packageDirs(changedFiles) {
	const dirs = new Set();
	const packagesDir = join(root, 'packages');
	if (existsSync(packagesDir)) {
		for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
			if (entry.isDirectory()) dirs.add(`packages/${entry.name}`);
		}
	}
	// A package deleted in this change no longer exists on disk, so pick it up
	// from the diff as well.
	for (const file of changedFiles) {
		const parts = file.split('/');
		if (parts.length > 2 && parts[0] === 'packages') dirs.add(`packages/${parts[1]}`);
	}
	return [...dirs].sort();
}

function main() {
	const base = process.env.BASE_SHA ?? '';
	const head = process.env.HEAD_SHA ?? '';
	if (base === '' || head === '') {
		console.error('docs-drift: BASE_SHA and HEAD_SHA are required');
		return 2;
	}
	if (OPT_OUT.test(process.env.PR_BODY ?? '')) {
		console.log("docs-drift: opt-out claimed in the pull request body ('no docs needed: ...').");
		return 0;
	}

	const changed = changedFilesBetween(base, head);
	const surfaceChanges = packageDirs(changed).map((dir) => {
		const manifest = `${dir}/package.json`;
		const { added, removed } = diffKeys(
			exportKeys(showAtRef(base, manifest)),
			exportKeys(showAtRef(head, manifest)),
		);
		return { name: dir.slice('packages/'.length), readme: `${dir}/README.md`, added, removed };
	});

	const found = findDrift(surfaceChanges, changed);
	if (found.length === 0) {
		console.log('docs-drift: no package changed its published entry points without its README.');
		return 0;
	}

	console.error('docs-drift: a package changed what it publishes without documenting it.\n');
	for (const message of found) console.error(`  - ${message}`);
	console.error(
		'\nDescribe the entry point in the package README in the same change, or state why none\n' +
			"is needed by writing 'no docs needed: <reason>' in the pull request body. An ADR does\n" +
			'not count: it records a decision rather than describing the surface.',
	);
	return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}
