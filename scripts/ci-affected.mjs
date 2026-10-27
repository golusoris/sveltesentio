import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TURBO_ROOT_PREFIX = '$TURBO_ROOT$/';

export const SHARED_SURFACE_PATTERNS = [
	/^package\.json$/,
	/^pnpm-lock\.yaml$/,
	/^pnpm-workspace\.yaml$/,
	/^turbo\.json$/,
	/^tsconfig(\..*)?\.json$/,
	/^eslint\.config\.(ts|js|mjs|cjs)$/,
	/^prettier\.config\.(js|mjs|cjs)$/,
	/^commitlint\.config\.(js|mjs|cjs)$/,
	/^vitest\.shared\.ts$/,
	/^Makefile$/,
	/^\.github\//,
	/^scripts\//,
	/^packages\/core\//,
	/^packages\/testing\//,
];

export const DOCS_ONLY_PATTERNS = [
	/\.md$/,
	/^docs\//,
	/^\.workingdir\//,
	/^LICENSE$/,
	/^CODE_OF_CONDUCT\.md$/,
	/^SECURITY\.md$/,
	/^\.editorconfig$/,
	/^\.markdownlint/,
];

export const PACKAGE_DIRECTORY_MAP = {
	'packages/ai': '@sveltesentio/ai',
	'packages/api': '@sveltesentio/api',
	'packages/auth': '@sveltesentio/auth',
	'packages/charts': '@sveltesentio/charts',
	'packages/collab': '@sveltesentio/collab',
	'packages/core': '@sveltesentio/core',
	'packages/emulator': '@sveltesentio/emulator',
	'packages/flow': '@sveltesentio/flow',
	'packages/forms': '@sveltesentio/forms',
	'packages/i18n': '@sveltesentio/i18n',
	'packages/ipc-sockmap': '@sveltesentio/ipc-sockmap',
	'packages/mcp': '@sveltesentio/mcp',
	'packages/media': '@sveltesentio/media',
	'packages/query': '@sveltesentio/query',
	'packages/realtime': '@sveltesentio/realtime',
	'packages/shell': '@sveltesentio/shell',
	'packages/testing': '@sveltesentio/testing',
	'packages/ui': '@sveltesentio/ui',
	'packages/uploads': '@sveltesentio/uploads',
	'apps/docs': '@sveltesentio/docs',
	'apps/integration': '@sveltesentio/integration',
	'apps/storybook': '@sveltesentio/storybook',
	'apps/sveltekit-fixture': '@sveltesentio/sveltekit-fixture',
};

/**
 * The globs outside its own folder that one package's turbo.json declares as
 * task inputs, without the `$TURBO_ROOT$/` prefix. Inputs inside the package
 * folder are skipped; a negation, a `../` path or another `$` variable has no
 * rule here and throws, so the change detection fails instead of guessing.
 * @param {string} configPath
 * @returns {string[]}
 */
function readRootInputs(configPath) {
	const tasks = Object.values(JSON.parse(readFileSync(configPath, 'utf8')).tasks ?? {});
	const globs = [];
	for (let i = 0; i < tasks.length; i += 1) {
		const inputs = tasks[i].inputs ?? [];
		for (let j = 0; j < inputs.length; j += 1) {
			const input = inputs[j];
			if (input.startsWith(TURBO_ROOT_PREFIX)) {
				globs.push(input.slice(TURBO_ROOT_PREFIX.length));
			} else if (input !== '$TURBO_DEFAULT$' && /^(!|\.\.\/|\$)/.test(input)) {
				throw new Error(`${configPath}: no rule for the turbo input ${input}`);
			}
		}
	}
	return globs;
}

/**
 * The repository files outside its own folder that each package reads, as
 * declared by the `$TURBO_ROOT$/` inputs of its turbo.json. Turbo hashes those
 * files for the cache; the same declaration selects the package here, so a
 * change to one of them runs the package's jobs even when it is documentation.
 * @param {string} [rootDir]
 * @returns {{ glob: string, pkg: string }[]}
 */
export function loadRootReaders(rootDir = REPO_ROOT) {
	const readers = [];
	const dirEntries = Object.entries(PACKAGE_DIRECTORY_MAP);
	for (let i = 0; i < dirEntries.length; i += 1) {
		const [dir, pkg] = dirEntries[i];
		const configPath = join(rootDir, dir, 'turbo.json');
		if (existsSync(configPath)) {
			for (const glob of readRootInputs(configPath)) readers.push({ glob, pkg });
		}
	}
	return readers;
}

/**
 * @returns {{
 *   allAffected: boolean,
 *   hasCodeChanges: boolean,
 *   sharedSurfaces: string[],
 *   affectedPackages: string[],
 *   turboFilter: string
 * }}
 */
function createEmptyResult() {
	return {
		allAffected: false,
		hasCodeChanges: false,
		sharedSurfaces: [],
		affectedPackages: [],
		turboFilter: '',
	};
}

/**
 * Resolves affected package names from normalized file paths.
 * @param {string[]} normalizedFiles
 * @returns {string[]}
 */
function findAffectedPackages(normalizedFiles) {
	const dirEntries = Object.entries(PACKAGE_DIRECTORY_MAP);
	const affectedPkgSet = new Set();
	for (let i = 0; i < normalizedFiles.length; i += 1) {
		const file = normalizedFiles[i];
		for (let j = 0; j < dirEntries.length; j += 1) {
			const [dir, pkgName] = dirEntries[j];
			if (file.startsWith(`${dir}/`)) {
				affectedPkgSet.add(pkgName);
				break;
			}
		}
	}
	return Array.from(affectedPkgSet).sort();
}

/**
 * Resolves the packages that read a changed file outside their own folder.
 * @param {string[]} normalizedFiles
 * @param {{ glob: string, pkg: string }[]} readers
 * @returns {string[]}
 */
function findReaderPackages(normalizedFiles, readers) {
	const readerPkgSet = new Set();
	for (let i = 0; i < normalizedFiles.length; i += 1) {
		for (let j = 0; j < readers.length; j += 1) {
			if (posix.matchesGlob(normalizedFiles[i], readers[j].glob)) {
				readerPkgSet.add(readers[j].pkg);
			}
		}
	}
	return Array.from(readerPkgSet).sort();
}

/**
 * A package whose own folder changed runs with its dependencies and dependents
 * (`...pkg...`). A package that only reads a changed file outside its folder
 * runs alone (`pkg`): its dependents do not read that file.
 * @param {string[]} ownPackages
 * @param {string[]} readerPackages
 */
function selectPackages(ownPackages, readerPackages) {
	const own = new Set(ownPackages);
	const affectedPackages = Array.from(new Set([...ownPackages, ...readerPackages])).sort();
	if (affectedPackages.length === 0) {
		return createEmptyResult();
	}
	const filterArgs = affectedPackages
		.map((pkg) => (own.has(pkg) ? `--filter=...${pkg}...` : `--filter=${pkg}`))
		.join(' ');
	return {
		allAffected: false,
		hasCodeChanges: true,
		sharedSurfaces: [],
		affectedPackages,
		turboFilter: filterArgs,
	};
}

/**
 * Analyzes a list of changed file paths and returns the change impact.
 * @param {string[]} changedFiles
 * @param {{ glob: string, pkg: string }[]} [readers] defaults to loadRootReaders()
 * @returns {{
 *   allAffected: boolean,
 *   hasCodeChanges: boolean,
 *   sharedSurfaces: string[],
 *   affectedPackages: string[],
 *   turboFilter: string
 * }}
 */
export function analyzeChanges(changedFiles, readers) {
	if (!changedFiles || changedFiles.length === 0) {
		return createEmptyResult();
	}

	const normalizedFiles = changedFiles.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''));
	const sharedSurfaces = normalizedFiles.filter((file) =>
		SHARED_SURFACE_PATTERNS.some((pattern) => pattern.test(file)),
	);

	const readerPackages = findReaderPackages(normalizedFiles, readers ?? loadRootReaders());
	const isDocsOnly = normalizedFiles.every((file) =>
		DOCS_ONLY_PATTERNS.some((pattern) => pattern.test(file)),
	);
	if (isDocsOnly) {
		return selectPackages([], readerPackages);
	}

	if (sharedSurfaces.length > 0) {
		return {
			allAffected: true,
			hasCodeChanges: true,
			sharedSurfaces,
			affectedPackages: Object.values(PACKAGE_DIRECTORY_MAP),
			turboFilter: '',
		};
	}

	return selectPackages(findAffectedPackages(normalizedFiles), readerPackages);
}

/**
 * Gets git changed files between base and head.
 * @param {string} baseRef
 * @param {string} headRef
 * @returns {string[]}
 */
export function getGitDiffFiles(baseRef = 'origin/main', headRef = 'HEAD') {
	const range = `${baseRef}...${headRef}`;
	try {
		// An argument vector, never a shell string: the refs come from the command line
		// and the environment, and `--end-of-options` keeps a ref that starts with a
		// dash from being read as a git option.
		const output = execFileSync('git', ['diff', '--name-only', '--end-of-options', range], {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return output
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
	} catch (error) {
		// A diff against another range would select the wrong packages, so a bad ref stops the job.
		const stderr = String(error?.stderr ?? '').trim();
		throw new Error(`ci-affected: git diff ${range} failed${stderr ? `: ${stderr}` : ''}`, {
			cause: error,
		});
	}
}

/**
 * Resolves packages that have stories, derived from apps/storybook config globs
 * and including the storybook app package itself.
 * @param {string} [rootDir]
 * @returns {string[]}
 */
export function loadStoryPackages(rootDir = REPO_ROOT) {
	const mainPath = join(rootDir, 'apps/storybook/.storybook/main.ts');
	const storyPackages = new Set(['@sveltesentio/storybook']);
	if (!existsSync(mainPath)) {
		return Array.from(storyPackages);
	}
	const content = readFileSync(mainPath, 'utf8');
	const match = /stories:\s*\[([^\]]+)\]/.exec(content);
	if (!match) {
		return Array.from(storyPackages);
	}
	const globs = Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g), (m) => m[1]);
	for (let i = 0; i < globs.length; i += 1) {
		const normalized = posix.normalize(join('apps/storybook/.storybook', globs[i]));
		const matches = globSync(normalized, { cwd: rootDir });
		for (let j = 0; j < matches.length; j += 1) {
			const m = matches[j].replace(/\\/g, '/');
			for (const [dir, pkgName] of Object.entries(PACKAGE_DIRECTORY_MAP)) {
				if (m.startsWith(`${dir}/`)) {
					storyPackages.add(pkgName);
					break;
				}
			}
		}
	}
	return Array.from(storyPackages).sort();
}

/**
 * Resolves space-separated files Prettier handles (not deleted, not ignored, supported parser).
 * @param {string[]} files
 * @param {string} [rootDir]
 * @returns {Promise<string>}
 */
export async function resolvePrettierFiles(files, rootDir = REPO_ROOT) {
	if (!files || files.length === 0) return '';
	const prettier = await import('prettier');
	const getFileInfo = prettier.getFileInfo ?? prettier.default?.getFileInfo;
	const ignorePath = join(rootDir, '.prettierignore');
	const hasIgnore = existsSync(ignorePath);
	const handled = [];

	for (let i = 0; i < files.length; i += 1) {
		const rel = files[i].replace(/\\/g, '/').replace(/^\.\//, '');
		const full = join(rootDir, rel);
		if (!existsSync(full)) continue;

		try {
			const info = await getFileInfo(full, {
				ignorePath: hasIgnore ? ignorePath : undefined,
				resolveConfig: true,
			});
			if (!info.ignored && info.inferredParser !== null) {
				handled.push(rel);
			}
		} catch (error) {
			if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
				continue;
			}
			throw new Error(
				`ci-affected: prettier getFileInfo failed for ${rel}: ${error?.message ?? error}`,
				{
					cause: error,
				},
			);
		}
	}

	return handled.join(' ');
}

/**
 * Returns true if the CI event requires a full run (anything other than pull_request).
 * @param {string | null | undefined} ciEvent
 * @returns {boolean}
 */
export function isFullEvent(ciEvent) {
	return Boolean(ciEvent && ciEvent !== 'pull_request');
}

/**
 * Creates a result object for a full CI run.
 * @returns {{
 *   allAffected: boolean,
 *   hasCodeChanges: boolean,
 *   sharedSurfaces: string[],
 *   affectedPackages: string[],
 *   turboFilter: string,
 *   changedFiles: number,
 *   prettierFiles: string,
 *   hasStories: boolean,
 * }}
 */
function createFullResult() {
	return {
		allAffected: true,
		hasCodeChanges: true,
		sharedSurfaces: [],
		affectedPackages: Object.values(PACKAGE_DIRECTORY_MAP),
		turboFilter: '',
		changedFiles: 0,
		prettierFiles: '',
		hasStories: true,
	};
}

/**
 * Emits exactly one stderr line indicating CI scope.
 * @param {{ allAffected: boolean, sharedSurfaces: string[] }} result
 * @param {string | null} ciEvent
 * @param {string} baseRef
 * @param {number} filesCount
 */
function logScope(result, ciEvent, baseRef, filesCount) {
	if (isFullEvent(ciEvent)) {
		process.stderr.write(`ci-scope: full (${ciEvent} event)\n`);
		return;
	}
	if (result.allAffected) {
		const reason =
			result.sharedSurfaces.length > 0
				? `shared surface: ${result.sharedSurfaces.join(', ')}`
				: 'all packages affected';
		process.stderr.write(`ci-scope: full (${reason})\n`);
		return;
	}
	process.stderr.write(`ci-scope: diff-aware, ${filesCount} changed files vs ${baseRef}\n`);
}

/**
 * Writes outputs to GITHUB_OUTPUT if the path is provided.
 * @param {string | null} githubOutput
 * @param {{
 *   allAffected: boolean,
 *   hasCodeChanges: boolean,
 *   turboFilter: string,
 *   affectedPackages: string[],
 *   changedFiles: number,
 *   prettierFiles: string,
 *   hasStories: boolean,
 * }} result
 */
async function writeGithubOutput(githubOutput, result) {
	if (!githubOutput) return;
	const fs = await import('node:fs/promises');
	const out = [
		`all_affected=${result.allAffected}`,
		`has_code_changes=${result.hasCodeChanges}`,
		`turbo_filter=${result.turboFilter}`,
		`affected_packages=${JSON.stringify(result.affectedPackages)}`,
		`changed_files=${result.changedFiles}`,
		`prettier_files=${result.prettierFiles}`,
		`has_stories=${result.hasStories}`,
	].join('\n');
	await fs.appendFile(githubOutput, `${out}\n`);
}

/**
 * Runs the complete change impact and scope analysis.
 * @param {{
 *   ciEvent?: string | null,
 *   baseRef?: string,
 *   headRef?: string,
 *   explicitFiles?: string[] | null,
 *   githubOutput?: string | null,
 *   rootDir?: string,
 *   readers?: { glob: string, pkg: string }[],
 * }} [options]
 * @returns {Promise<{
 *   allAffected: boolean,
 *   hasCodeChanges: boolean,
 *   sharedSurfaces: string[],
 *   affectedPackages: string[],
 *   turboFilter: string,
 *   changedFiles: number,
 *   prettierFiles: string,
 *   hasStories: boolean,
 * }>}
 */
export async function runCiAffected(options = {}) {
	const rootDir = options.rootDir ?? REPO_ROOT;
	const ciEvent = options.ciEvent ?? process.env.CI_EVENT ?? null;
	const githubOutput = options.githubOutput ?? process.env.GITHUB_OUTPUT ?? null;
	const baseRef = options.baseRef ?? process.env.BASE_REF ?? 'origin/main';
	const headRef = options.headRef ?? process.env.HEAD_REF ?? 'HEAD';

	if (isFullEvent(ciEvent)) {
		const result = createFullResult();
		logScope(result, ciEvent, baseRef, 0);
		await writeGithubOutput(githubOutput, result);
		return result;
	}

	const files =
		options.explicitFiles !== undefined && options.explicitFiles !== null
			? options.explicitFiles
			: getGitDiffFiles(baseRef, headRef);

	const analysis = analyzeChanges(files, options.readers);
	const prettierFiles = analysis.allAffected ? '' : await resolvePrettierFiles(files, rootDir);

	const storyPackages = loadStoryPackages(rootDir);
	const hasStories =
		analysis.allAffected || analysis.affectedPackages.some((pkg) => storyPackages.includes(pkg));

	const result = {
		...analysis,
		changedFiles: files.length,
		prettierFiles,
		hasStories,
	};

	logScope(result, ciEvent, baseRef, files.length);
	await writeGithubOutput(githubOutput, result);
	return result;
}

// Run the CLI only when this module is the process entry point.
//
// The previous guard compared `resolve(process.argv[1])` with itself, which is
// true for any entry point, so importing the module *ran* the CLI. Under vitest
// that meant `packages/testing/test/ci-workflow.test.ts` shelled out to
// `git diff` on import and printed the analysis JSON into the test output — and
// because every GitHub Actions step sets GITHUB_OUTPUT, the Test job appended
// `has_code_changes=false` and `turbo_filter=` to its own step outputs. Nothing
// reads those today, which is the only reason it was invisible: any future step
// that did would have seen a build-skipping verdict computed by the wrong job.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const args = process.argv.slice(2);
	let baseRef = process.env.BASE_REF || 'origin/main';
	let headRef = process.env.HEAD_REF || 'HEAD';
	let ciEvent = process.env.CI_EVENT || null;
	let explicitFiles = null;

	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === '--base' && args[i + 1]) {
			baseRef = args[++i];
		} else if (args[i] === '--head' && args[i + 1]) {
			headRef = args[++i];
		} else if (args[i] === '--event' && args[i + 1]) {
			ciEvent = args[++i];
		} else if (args[i] === '--files') {
			explicitFiles = args.slice(i + 1);
			break;
		}
	}

	const result = await runCiAffected({
		baseRef,
		headRef,
		ciEvent,
		explicitFiles,
	});

	console.log(JSON.stringify(result, null, 2));
}
