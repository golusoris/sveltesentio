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

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const WALK_LIMIT = 100_000;

/**
 * Walk a directory tree recursively up to WALK_LIMIT entries (HISS-02).
 *
 * @param {string} dir
 * @param {string[]} out
 * @returns {Promise<string[]>}
 */
export async function walk(dir, out = []) {
	const stack = [{ isDir: true, path: dir }];

	for (let step = 0; step < WALK_LIMIT; step += 1) {
		const item = stack.pop();
		if (item === undefined) break;

		if (!item.isDir) {
			out.push(item.path);
			continue;
		}

		let entries;
		try {
			entries = await readdir(item.path, { withFileTypes: true });
		} catch (error) {
			if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
				continue;
			}
			throw error;
		}

		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (entry.name === 'node_modules') continue;
			const full = join(item.path, entry.name);
			if (entry.isDirectory()) {
				stack.push({ isDir: true, path: full });
			} else if (entry.name.endsWith('.svelte')) {
				stack.push({ isDir: false, path: full });
			}
		}
	}

	if (stack.length > 0) {
		throw new Error(`walk exceeded limit of ${WALK_LIMIT} steps`);
	}
	return out;
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

/**
 * Read package.json and extract exported target paths.
 * Only ENOENT may skip (returns empty Set). Read/parse failures throw with path and cause.
 *
 * @param {string} pkgPath
 * @returns {Promise<Set<string>>}
 */
export async function readPackageExportTargets(pkgPath) {
	const pkgJsonPath = join(pkgPath, 'package.json');
	let raw;
	try {
		raw = await readFile(pkgJsonPath, 'utf8');
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			return new Set();
		}
		throw new Error(`Failed to read package.json at ${pkgJsonPath}: ${error?.message ?? error}`, {
			cause: error,
		});
	}

	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Failed to parse package.json at ${pkgJsonPath}: ${error?.message ?? error}`, {
			cause: error,
		});
	}

	if (manifest && manifest.exports) {
		return collectExportTargets(manifest.exports);
	}
	return new Set();
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
		const reason = rawReason.replace(/(?:-->|\*\/)\s*$/, '').trim();
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

/**
 * Lists every Svelte component under `dir` that lacks a Storybook story.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function findComponentsWithoutStory(dir = packagesDir) {
	const missing = [];
	let packageEntries;
	try {
		packageEntries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error && error.code === 'ENOENT') return [];
		throw error;
	}

	for (const pkgEntry of packageEntries) {
		if (!pkgEntry.isDirectory()) continue;
		const pkgPath = join(dir, pkgEntry.name);
		const srcPath = join(pkgPath, 'src');

		let srcStat;
		try {
			srcStat = await stat(srcPath);
		} catch (error) {
			if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
				continue;
			}
			throw new Error(`Failed to stat src at ${srcPath}: ${error?.message ?? error}`, {
				cause: error,
			});
		}
		if (!srcStat.isDirectory()) continue;

		const exportedTargets = await readPackageExportTargets(pkgPath);
		const svelteFiles = await walk(srcPath);
		const storyFiles = svelteFiles.filter((f) => f.endsWith('.stories.svelte'));
		const componentFiles = svelteFiles.filter((f) => !f.endsWith('.stories.svelte'));

		const internalPrefix = join(srcPath, 'internal');
		const eligible = componentFiles.filter((file) => {
			if (file.startsWith(internalPrefix)) {
				const rel = '.' + file.slice(pkgPath.length);
				return exportedTargets.has(rel);
			}
			return true;
		});

		const storyContents = await readStoryFiles(storyFiles);
		for (const compFile of eligible) {
			const compName = basename(compFile, '.svelte');
			if (await hasSiblingStory(compFile)) continue;
			const isCovered = storyContents.some(
				(content) => hasComponentImport(content, compName) || hasStoryCovers(content, compName),
			);
			if (!isCovered) {
				missing.push(compFile);
			}
		}
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
