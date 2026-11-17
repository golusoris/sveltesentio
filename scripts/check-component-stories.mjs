#!/usr/bin/env node
// Fails if any Svelte component in packages/*/src has no Storybook story.
//
// Every public component must have a co-located *.stories.svelte story or be
// covered by a story in the same package (via import or explicit `story-covers:`
// declaration), ensuring all components are showcased and verified for accessibility
// under the axe-core story test runner (ADR-0056).
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { walk as walkDirectory } from './check-import-cycles.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const SVELTE_WALK_OPTIONS = {
	keepFile: (entry) => entry.name.endsWith('.svelte'),
	enterDir: (entry) => entry.name !== 'node_modules',
};

/**
 * Walk a directory tree and return `.svelte` file paths outside `node_modules`.
 *
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {Promise<string[]>}
 */
export async function walk(dir, out = []) {
	return walkDirectory(dir, out, SVELTE_WALK_OPTIONS);
}

/**
 * Collect all exported target paths from a package.json exports field.
 *
 * @param {unknown} exportsField
 * @returns {Set<string>}
 */
function collectExportTargets(exportsField) {
	const targets = new Set();
	const recurse = (node) => {
		if (typeof node === 'string') {
			if (node.startsWith('./')) targets.add(node);
		} else if (node && typeof node === 'object') {
			for (const value of Object.values(node)) recurse(value);
		}
	};
	recurse(exportsField);
	return targets;
}

/** Returns an error's message string, or the thrown value when it has no message. */
function errorDetail(error) {
	return error?.message ?? error;
}

/** Returns the UTF-8 text of `pkgJsonPath`, or `undefined` when the file is absent. */
async function readPackageJsonText(pkgJsonPath) {
	try {
		return await readFile(pkgJsonPath, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		const message = `Failed to read package.json at ${pkgJsonPath}: ${errorDetail(error)}`;
		throw new Error(message, { cause: error });
	}
}

/** Returns the parsed JSON value of `raw`, throwing with `pkgJsonPath` and cause on failure. */
function parsePackageManifest(raw, pkgJsonPath) {
	try {
		return JSON.parse(raw);
	} catch (error) {
		const message = `Failed to parse package.json at ${pkgJsonPath}: ${errorDetail(error)}`;
		throw new Error(message, { cause: error });
	}
}

/**
 * Read package.json and extract exported target paths.
 * Only ENOENT may skip (returns empty Set). Read/parse failures throw with path and cause.
 *
 * @param {string} pkgPath
 * @returns {Promise<Set<string>>}
 */
export async function readPackageExportTargets(pkgPath) {
	const pkgJsonPath = join(pkgPath, 'package.json');
	const raw = await readPackageJsonText(pkgJsonPath);
	if (raw === undefined) return new Set();

	const manifest = parsePackageManifest(raw, pkgJsonPath);
	if (!manifest?.exports) return new Set();
	return collectExportTargets(manifest.exports);
}

/**
 * Check whether a component has a co-located *.stories.svelte sibling.
 * Only ENOENT/ENOTDIR may return false; any other error throws with path and cause.
 *
 * @param {string} compFile
 * @returns {Promise<boolean>}
 */
export async function hasSiblingStory(compFile) {
	const compName = basename(compFile, '.svelte');
	const siblingStory = join(dirname(compFile), `${compName}.stories.svelte`);
	try {
		const s = await stat(siblingStory);
		return s.isFile();
	} catch (error) {
		if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
			return false;
		}
		throw new Error(`Failed to stat sibling story at ${siblingStory}: ${error?.message ?? error}`, {
			cause: error,
		});
	}
}

/**
 * Read all story file contents.
 * No silent skip: any read failure throws with path and cause.
 *
 * @param {string[]} storyFiles
 * @returns {Promise<string[]>}
 */
export async function readStoryFiles(storyFiles) {
	const contents = [];
	for (const storyFile of storyFiles) {
		try {
			contents.push(await readFile(storyFile, 'utf8'));
		} catch (error) {
			throw new Error(`Failed to read story file at ${storyFile}: ${error?.message ?? error}`, {
				cause: error,
			});
		}
	}
	return contents;
}

/**
 * Check whether a story source contains a whole-word component import.
 *
 * @param {string} source
 * @param {string} componentName
 * @returns {boolean}
 */
export function hasComponentImport(source, componentName) {
	const importRegex =
		/(?:^|\n)\s*import\s+[\s\S]*?from\s*['"][^'"]+['"]|(?:^|\n)\s*import\s*['"][^'"]+['"]|\bimport\s*\([^)]+\)/g;
	const wordRegex = new RegExp(`\\b${componentName}\\b`);
	let match;
	while ((match = importRegex.exec(source)) !== null) {
		const cleaned = match[0].replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
		if (wordRegex.test(cleaned)) return true;
	}
	return false;
}

/**
 * Check whether a story source contains a whole-word `story-covers:` declaration.
 *
 * Syntax: `story-covers: ComponentA, ComponentB — reason` or `... - reason`
 * A component must match a whole word in the comma-separated list, and the reason
 * following an em dash (`—`) or spaced hyphen (` - `) is required.
 *
 * @param {string} source
 * @param {string} componentName
 * @returns {boolean}
 */
export function hasStoryCovers(source, componentName) {
	const lines = source.split(/\r?\n/);
	const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const wordRegex = new RegExp(`\\b${escaped}\\b`);

	for (const line of lines) {
		const marker = 'story-covers:';
		const markerIdx = line.indexOf(marker);
		if (markerIdx === -1) continue;

		const afterMarker = line.slice(markerIdx + marker.length);
		const sepMatch = /(?:\s*—\s*|\s+-\s+)/.exec(afterMarker);
		if (!sepMatch) continue;

		const rawReason = afterMarker.slice(sepMatch.index + sepMatch[0].length);
		// HTML also ends a comment at `--!>`.
		const reason = rawReason.replace(/(?:--!?>|\*\/)\s*$/, '').trim();
		if (!reason) continue;

		const componentsPart = afterMarker.slice(0, sepMatch.index);
		const items = componentsPart
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);

		if (items.some((item) => wordRegex.test(item))) {
			return true;
		}
	}
	return false;
}

/** Returns directory entries under `dir`, or `[]` when `dir` does not exist. */
async function readPackageDirs(dir) {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory());
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}

/** Returns whether `srcPath` is an existing directory, throwing on unexpected `stat` errors. */
async function hasSourceDirectory(srcPath) {
	try {
		const srcStat = await stat(srcPath);
		return srcStat.isDirectory();
	} catch (error) {
		if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
		const message = `Failed to stat src at ${srcPath}: ${errorDetail(error)}`;
		throw new Error(message, { cause: error });
	}
}

/** Returns whether `file` is outside `src/internal` or listed in `exportedTargets`. */
function isEligible(file, pkgPath, exportedTargets) {
	if (!file.startsWith(join(pkgPath, 'src', 'internal'))) return true;
	return exportedTargets.has('.' + file.slice(pkgPath.length));
}

/** Returns whether `compFile` has a sibling story or is covered by `storyContents`. */
async function isCoveredByPackageStories(compFile, storyContents) {
	if (await hasSiblingStory(compFile)) return true;
	const name = basename(compFile, '.svelte');
	return storyContents.some((c) => hasComponentImport(c, name) || hasStoryCovers(c, name));
}

/** Returns eligible Svelte component paths in `pkgPath` that lack story coverage. */
async function findMissingInPackage(pkgPath) {
	const srcPath = join(pkgPath, 'src');
	if (!(await hasSourceDirectory(srcPath))) return [];

	const exportedTargets = await readPackageExportTargets(pkgPath);
	const svelteFiles = await walk(srcPath);
	const storyFiles = svelteFiles.filter((f) => f.endsWith('.stories.svelte'));
	const componentFiles = svelteFiles.filter((f) => !f.endsWith('.stories.svelte'));
	const eligible = componentFiles.filter((f) => isEligible(f, pkgPath, exportedTargets));

	const storyContents = await readStoryFiles(storyFiles);
	const missing = [];
	for (const compFile of eligible) {
		if (!(await isCoveredByPackageStories(compFile, storyContents))) {
			missing.push(compFile);
		}
	}
	return missing;
}

/**
 * Lists every Svelte component under `dir` that lacks a Storybook story.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function findComponentsWithoutStory(dir = packagesDir) {
	const missing = [];
	const packageEntries = await readPackageDirs(dir);
	for (const pkgEntry of packageEntries) {
		const pkgMissing = await findMissingInPackage(join(dir, pkgEntry.name));
		missing.push(...pkgMissing);
	}
	return missing;
}

export async function main() {
	const missing = await findComponentsWithoutStory(packagesDir);
	if (missing.length > 0) {
		console.error('Components without stories:');
		for (const file of missing) {
			console.error(`  - ${relative(root, file)}`);
		}
		process.exit(1);
	}
	console.log('OK: all Svelte components have a Storybook story.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
