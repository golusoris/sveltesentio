import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DOCS_ONLY_PATTERNS,
	GATED_DOC_PATTERNS,
	PACKAGE_DIRECTORY_MAP,
	SHARED_SURFACE_PATTERNS,
	analyzeChanges,
	getGitDiffFiles,
	hasAffectedStories,
	isFullEvent,
	isPrettierHandled,
	loadRootReaders,
	loadStoryPackages,
	pickPrettierGetFileInfo,
	resolvePrettierFiles,
	runCiAffected,
} from './ci-affected.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('ci-affected: analyzeChanges', () => {
	it('handles empty list or null/undefined inputs', () => {
		const expectedEmpty = {
			allAffected: false,
			hasCodeChanges: false,
			sharedSurfaces: [],
			affectedPackages: [],
			turboFilter: '',
		};

		assert.deepEqual(analyzeChanges([]), expectedEmpty);
		assert.deepEqual(analyzeChanges(null), expectedEmpty);
		assert.deepEqual(analyzeChanges(undefined), expectedEmpty);
	});

	// Until A2-13 this test fed docs/principles.md and expected no code change. The
	// mcp tests and the docs app build read that file, so a pull request that broke
	// it skipped both jobs and reported green; those files now select their readers
	// (see the reader tests below). Documentation no package reads still skips.
	it('returns docs-only impact when only documentation no package reads changes', () => {
		const res = analyzeChanges(['README.md', 'CONTRIBUTING.md']);
		assert.deepEqual(res, {
			allAffected: false,
			hasCodeChanges: false,
			sharedSurfaces: [],
			affectedPackages: [],
			turboFilter: '',
		});
	});

	it('treats markdown inside a package or a shared surface as docs-only', () => {
		const expectedEmpty = {
			allAffected: false,
			hasCodeChanges: false,
			sharedSurfaces: [],
			affectedPackages: [],
			turboFilter: '',
		};
		assert.deepEqual(analyzeChanges(['packages/ui/README.md']), expectedEmpty);
		assert.deepEqual(analyzeChanges(['.github/PULL_REQUEST_TEMPLATE.md']), expectedEmpty);
	});

	it('returns allAffected when shared surfaces change', () => {
		const res = analyzeChanges(['turbo.json']);
		assert.deepEqual(res, {
			allAffected: true,
			hasCodeChanges: true,
			sharedSurfaces: ['turbo.json'],
			affectedPackages: Object.values(PACKAGE_DIRECTORY_MAP),
			turboFilter: '',
		});
	});

	it('treats docs/CODEOWNERS as a shared surface', () => {
		const res = analyzeChanges(['docs/CODEOWNERS'], []);
		assert.equal(res.allAffected, true);
		assert.equal(res.hasCodeChanges, true);
		assert.deepEqual(res.sharedSurfaces, ['docs/CODEOWNERS']);
	});

	it('keeps ordinary docs paths docs-only', () => {
		const res = analyzeChanges(['docs/adr/0001.md'], []);
		assert.equal(res.allAffected, false);
		assert.equal(res.hasCodeChanges, false);
		assert.deepEqual(res.sharedSurfaces, []);
	});

	it('analyzes single package change', () => {
		const res = analyzeChanges(['packages/ui/src/button.svelte']);
		assert.deepEqual(res, {
			allAffected: false,
			hasCodeChanges: true,
			sharedSurfaces: [],
			affectedPackages: ['@sveltesentio/ui'],
			turboFilter: '--filter=...@sveltesentio/ui...',
		});
	});

	it('analyzes changes across two packages', () => {
		const res = analyzeChanges([
			'packages/ui/src/button.svelte',
			'packages/forms/src/input.svelte',
		]);
		assert.deepEqual(res, {
			allAffected: false,
			hasCodeChanges: true,
			sharedSurfaces: [],
			affectedPackages: ['@sveltesentio/forms', '@sveltesentio/ui'],
			turboFilter: '--filter=...@sveltesentio/forms... --filter=...@sveltesentio/ui...',
		});
	});

	it('returns no code changes for unknown paths outside packages and patterns', () => {
		const res = analyzeChanges(['unknown/path/to/file.txt']);
		assert.deepEqual(res, {
			allAffected: false,
			hasCodeChanges: false,
			sharedSurfaces: [],
			affectedPackages: [],
			turboFilter: '',
		});
	});

	it('hits each pattern in SHARED_SURFACE_PATTERNS at least once', () => {
		const testFiles = [
			'package.json',
			'pnpm-lock.yaml',
			'pnpm-workspace.yaml',
			'turbo.json',
			'tsconfig.json',
			'eslint.config.js',
			'prettier.config.js',
			'.prettierignore',
			'commitlint.config.js',
			'vitest.shared.ts',
			'Makefile',
			'.github/workflows/ci.yml',
			'scripts/ci-affected.mjs',
			'packages/core/src/index.ts',
			'packages/testing/src/index.ts',
			'CODEOWNERS',
			'docs/migrations/v0.2.md',
			'tools/migrations/README.md',
		];

		assert.equal(testFiles.length, SHARED_SURFACE_PATTERNS.length);
		for (let i = 0; i < testFiles.length; i++) {
			const file = testFiles[i];
			const pat = SHARED_SURFACE_PATTERNS[i];
			assert.ok(pat.test(file), `Expected ${pat} to match ${file}`);
			const res = analyzeChanges([file]);
			assert.equal(res.allAffected, true);
			assert.deepEqual(res.sharedSurfaces, [file]);
		}
	});

	it('runs the lint job for migration guides and codemods, which a docs-only change would skip', () => {
		for (const file of ['docs/migrations/v0.2.md', 'tools/migrations/README.md']) {
			assert.ok(
				GATED_DOC_PATTERNS.some((p) => p.test(file)),
				file,
			);
			const res = analyzeChanges([file], []);
			assert.equal(res.allAffected, true, file);
			assert.equal(res.hasCodeChanges, true, file);
		}
		const mixed = analyzeChanges(['tools/migrations/README.md', 'README.md'], []);
		assert.equal(mixed.allAffected, true);
		assert.deepEqual(mixed.sharedSurfaces, ['tools/migrations/README.md']);
		// Guides the check does not read stay docs-only.
		for (const file of [
			'docs/migrations/README.md',
			'docs/migrations/kit-2-to-3.md',
			'docs/migrations/downstream-antipatterns-v0.1.md',
		]) {
			const res = analyzeChanges([file], []);
			assert.equal(res.hasCodeChanges, false, file);
		}
	});

	it('hits each pattern in DOCS_ONLY_PATTERNS at least once', () => {
		const testFiles = [
			'CONTRIBUTING.md',
			'docs/adr/0001.md',
			'.workingdir/research/decisions-needed.md',
			'LICENSE',
			'CODE_OF_CONDUCT.md',
			'SECURITY.md',
			'.editorconfig',
			'.markdownlint.yaml',
		];

		assert.equal(testFiles.length, DOCS_ONLY_PATTERNS.length);
		for (let i = 0; i < testFiles.length; i++) {
			const file = testFiles[i];
			const pat = DOCS_ONLY_PATTERNS[i];
			assert.ok(pat.test(file), `Expected ${pat} to match ${file}`);
			// No readers: this checks the patterns alone; docs/adr/** has readers.
			const res = analyzeChanges([file], []);
			assert.equal(res.allAffected, false);
			assert.equal(res.hasCodeChanges, false);
		}
	});
});

describe('ci-affected: packages that read files outside their folder', () => {
	it('selects the readers of a changed docs file, without their dependents', () => {
		assert.deepEqual(analyzeChanges(['docs/principles.md']), {
			allAffected: false,
			hasCodeChanges: true,
			sharedSurfaces: [],
			affectedPackages: ['@sveltesentio/docs', '@sveltesentio/mcp'],
			turboFilter: '--filter=@sveltesentio/docs --filter=@sveltesentio/mcp',
		});
		assert.equal(
			analyzeChanges(['docs/adr/0001.md']).turboFilter,
			analyzeChanges(['docs/principles.md']).turboFilter,
		);
	});

	it('selects testing alone for renovate.json, which no package folder holds', () => {
		assert.deepEqual(analyzeChanges(['renovate.json']).affectedPackages, ['@sveltesentio/testing']);
		assert.equal(analyzeChanges(['renovate.json']).turboFilter, '--filter=@sveltesentio/testing');
	});

	it('selects mcp for another package AGENTS.md, and docs too for its package.json', () => {
		assert.equal(
			analyzeChanges(['packages/ui/AGENTS.md']).turboFilter,
			'--filter=@sveltesentio/mcp',
		);
		assert.equal(
			analyzeChanges(['packages/ui/package.json']).turboFilter,
			'--filter=@sveltesentio/docs --filter=@sveltesentio/mcp --filter=...@sveltesentio/ui...',
		);
	});

	it('keeps the dependents of a package whose own folder also changed', () => {
		assert.equal(
			analyzeChanges(['packages/mcp/src/index.ts', 'docs/principles.md']).turboFilter,
			'--filter=@sveltesentio/docs --filter=...@sveltesentio/mcp...',
		);
	});

	it('still skips a docs-only change when no package reads it', () => {
		assert.equal(analyzeChanges(['docs/architecture/context.puml']).hasCodeChanges, false);
		assert.equal(analyzeChanges(['packages/ui/README.md']).hasCodeChanges, false);
	});
});

describe('ci-affected: loadRootReaders', () => {
	/** @param {unknown} inputs */
	function fixtureRoot(inputs) {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-readers-'));
		mkdirSync(join(dir, 'packages', 'mcp'), { recursive: true });
		writeFileSync(
			join(dir, 'packages', 'mcp', 'turbo.json'),
			JSON.stringify({ tasks: { test: { inputs } } }),
		);
		return dir;
	}

	it('reads the $TURBO_ROOT$ inputs and skips inputs inside the package', () => {
		const dir = fixtureRoot(['$TURBO_DEFAULT$', 'src/**', '$TURBO_ROOT$/docs/x.md']);
		try {
			assert.deepEqual(loadRootReaders(dir), [{ glob: 'docs/x.md', pkg: '@sveltesentio/mcp' }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('returns no readers when no package has a turbo.json', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-readers-'));
		try {
			assert.deepEqual(loadRootReaders(dir), []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	for (const input of ['!$TURBO_ROOT$/docs/x.md', '../../docs/x.md', '$TURBO_OTHER$/x']) {
		it(`refuses the input ${input} instead of guessing what it reads`, () => {
			const dir = fixtureRoot([input]);
			try {
				assert.throws(() => loadRootReaders(dir), /no rule for the turbo input/);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	}
});

describe('ci-affected: every file a package reads outside the package folders selects it', () => {
	const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
		.split('\0')
		.filter(Boolean);
	const trackedSet = new Set(tracked);
	const packageDirs = Object.keys(PACKAGE_DIRECTORY_MAP).map((dir) => `${dir}/`);
	const inPackage = (/** @type {string} */ path) => packageDirs.some((dir) => path.startsWith(dir));
	// The two ways package code names a repository file: a literal that climbs out
	// of its folder (a glob or a file; a bare directory prefix is no read), and a
	// join or resolve on the repository-root variable with literal segments
	// (a file, or a directory the code lists). ROOT_JOIN takes the argument list
	// whole and literalSegments splits it: one regex repeating quoted arguments
	// backtracks exponentially (CodeQL js/redos).
	const CLIMB = /['"`]((?:\.\.\/)+[^'"`$]+)['"`]/g;
	const ROOT_JOIN = /(?:join|resolve)\(\s*(?:rootDir|repoRoot)\s*,([^)]*)\)/g;

	/** @returns {string[]} the segments, or none when an argument is not a string literal */
	function literalSegments(/** @type {string} */ args) {
		const parts = args
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);
		const segments = parts.map((part) => /^['"]([^'"]+)['"]$/.exec(part)?.[1] ?? '');
		return segments.includes('') ? [] : segments;
	}

	/** @returns {{ pkg: string, source: string, path: string }[]} */
	function findReads() {
		const reads = [];
		for (const [dir, pkg] of Object.entries(PACKAGE_DIRECTORY_MAP)) {
			const sources = tracked.filter(
				(f) => f.startsWith(`${dir}/`) && /\.(ts|js|mjs|cjs|svelte)$/.test(f),
			);
			for (const source of sources) {
				const text = readFileSync(join(root, source), 'utf8');
				for (const [, literal] of text.matchAll(CLIMB)) {
					const path = posix.join(posix.dirname(source), literal);
					const isRead = /[*?]/.test(path) || trackedSet.has(path);
					if (isRead && !path.startsWith('../') && !inPackage(path))
						reads.push({ pkg, source, path });
				}
				for (const [, args] of text.matchAll(ROOT_JOIN)) {
					const segments = literalSegments(args);
					if (segments.length > 0) reads.push({ pkg, source, path: posix.join(...segments) });
				}
			}
		}
		const seen = new Set();
		return reads.filter((r) => {
			const key = `${r.pkg} ${r.path} ${r.source}`;
			return !seen.has(key) && seen.add(key);
		});
	}

	const reads = findReads();

	it('finds the known reads, so the scan is not empty', () => {
		const found = reads.map((r) => `${r.pkg} ${r.path}`);
		for (const known of [
			'@sveltesentio/docs docs/**/*.md',
			'@sveltesentio/mcp docs/principles.md',
			'@sveltesentio/mcp docs/adr',
			'@sveltesentio/testing renovate.json',
		]) {
			assert.ok(found.includes(known), `scan lost ${known}; found ${found.join(', ')}`);
		}
	});

	for (const read of reads) {
		it(`${read.pkg} runs when ${read.path} changes (${read.source})`, () => {
			const files = tracked.filter(
				(f) =>
					!inPackage(f) &&
					(f === read.path || f.startsWith(`${read.path}/`) || posix.matchesGlob(f, read.path)),
			);
			for (const file of files) {
				const res = analyzeChanges([file]);
				assert.ok(
					res.allAffected || res.affectedPackages.includes(read.pkg),
					`${read.pkg} reads ${file} but a change to it does not select ${read.pkg}; declare it in that package's turbo.json inputs`,
				);
			}
		});
	}
});

describe('ci-affected: getGitDiffFiles', () => {
	it('lists the files that differ between two refs', () => {
		const files = getGitDiffFiles('HEAD', 'HEAD');
		assert.deepEqual(files, []);
	});

	it('fails on a ref git cannot resolve instead of diffing another range', () => {
		assert.throws(
			() => getGitDiffFiles('refs/heads/no-such-branch', 'HEAD'),
			/ci-affected: git diff refs\/heads\/no-such-branch\.\.\.HEAD failed/,
		);
	});

	it('never hands a ref to a shell', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-'));
		try {
			assert.throws(() => getGitDiffFiles(`HEAD; touch ${join(dir, 'ran')} #`, 'HEAD'));
			assert.deepEqual(readdirSync(dir), [], 'the ref was executed as a shell command');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('does not read a ref that starts with a dash as a git option', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-'));
		try {
			assert.throws(() => getGitDiffFiles(`--output=${join(dir, 'written')}`, 'HEAD'));
			assert.deepEqual(readdirSync(dir), [], 'the ref was read as a git option');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('ci-affected: runCiAffected and scope detection', () => {
	/**
	 * Runs the CLI helper with spawnSync to capture status, stdout, stderr, and GITHUB_OUTPUT.
	 * @param {string[]} args
	 * @param {Record<string, string>} [env]
	 */
	function runCli(args = [], env = {}) {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-test-'));
		const outputFile = join(dir, 'github_output');
		writeFileSync(outputFile, '');
		try {
			const res = spawnSync(process.execPath, [join(root, 'scripts/ci-affected.mjs'), ...args], {
				encoding: 'utf8',
				env: {
					...process.env,
					GITHUB_OUTPUT: outputFile,
					...env,
				},
			});
			return {
				status: res.status,
				stdout: res.stdout ?? '',
				stderr: res.stderr ?? '',
				githubOutput: readFileSync(outputFile, 'utf8'),
			};
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it('positive: one file in packages/forms -> forms + dependents only, count 1', async () => {
		const cli = runCli(['--files', 'packages/forms/src/index.ts'], { CI_EVENT: 'pull_request' });
		assert.equal(cli.status, 0);
		assert.match(cli.stderr, /^ci-scope: diff-aware, 1 changed files vs origin\/main/);
		const parsed = JSON.parse(cli.stdout);
		assert.equal(parsed.allAffected, false);
		assert.equal(parsed.hasCodeChanges, true);
		assert.equal(parsed.changedFiles, 1);
		assert.deepEqual(parsed.affectedPackages, ['@sveltesentio/forms']);
		assert.equal(parsed.turboFilter, '--filter=...@sveltesentio/forms...');
		assert.equal(parsed.prettierFiles, 'packages/forms/src/index.ts');
		assert.equal(parsed.hasStories, false);
		assert.match(cli.githubOutput, /all_affected=false/);
		assert.match(cli.githubOutput, /has_code_changes=true/);
		assert.match(cli.githubOutput, /changed_files=1/);
		assert.match(cli.githubOutput, /prettier_files=packages\/forms\/src\/index\.ts/);
		assert.match(cli.githubOutput, /has_stories=false/);
	});

	it('negative: bad BASE_REF -> nonzero exit', () => {
		const cli = runCli(['--base', 'refs/heads/no-such-branch'], { CI_EVENT: 'pull_request' });
		assert.notEqual(cli.status, 0);
		assert.match(cli.stderr, /ci-affected: git diff refs\/heads\/no-such-branch\.\.\.HEAD failed/);
	});

	it('negative: CI_EVENT=push -> full mode', () => {
		const cli = runCli(['--files', 'packages/forms/src/index.ts'], { CI_EVENT: 'push' });
		assert.equal(cli.status, 0);
		assert.match(cli.stderr, /^ci-scope: full \(push event\)/);
		const parsed = JSON.parse(cli.stdout);
		assert.equal(parsed.allAffected, true);
		assert.equal(parsed.hasCodeChanges, true);
		assert.equal(parsed.turboFilter, '');
		assert.equal(parsed.affectedPackages.length, Object.keys(PACKAGE_DIRECTORY_MAP).length);
		assert.equal(parsed.prettierFiles, '');
		assert.equal(parsed.hasStories, true);
		assert.match(cli.githubOutput, /all_affected=true/);
		assert.match(cli.githubOutput, /turbo_filter=\n/);
		assert.match(cli.githubOutput, /prettier_files=\n/);
		assert.match(cli.githubOutput, /has_stories=true/);
	});

	it('negative: shared surface file -> full mode', () => {
		const cli = runCli(['--files', 'package.json'], { CI_EVENT: 'pull_request' });
		assert.equal(cli.status, 0);
		assert.match(cli.stderr, /^ci-scope: full \(shared surface: package\.json\)/);
		const parsed = JSON.parse(cli.stdout);
		assert.equal(parsed.allAffected, true);
		assert.equal(parsed.hasCodeChanges, true);
		assert.deepEqual(parsed.sharedSurfaces, ['package.json']);
		assert.equal(parsed.turboFilter, '');
		assert.equal(parsed.prettierFiles, '');
		assert.equal(parsed.hasStories, true);
		assert.match(cli.githubOutput, /all_affected=true/);
	});

	it('boundary: empty diff -> count 0, nothing selected', () => {
		const cli = runCli(['--files'], { CI_EVENT: 'pull_request' });
		assert.equal(cli.status, 0);
		assert.match(cli.stderr, /^ci-scope: diff-aware, 0 changed files vs origin\/main/);
		const parsed = JSON.parse(cli.stdout);
		assert.equal(parsed.allAffected, false);
		assert.equal(parsed.hasCodeChanges, false);
		assert.deepEqual(parsed.affectedPackages, []);
		assert.equal(parsed.turboFilter, '');
		assert.equal(parsed.changedFiles, 0);
		assert.equal(parsed.prettierFiles, '');
		assert.equal(parsed.hasStories, false);
		assert.match(cli.githubOutput, /all_affected=false/);
		assert.match(cli.githubOutput, /has_code_changes=false/);
		assert.match(cli.githubOutput, /changed_files=0/);
	});

	it('boundary: docs-only -> no code changes', () => {
		const cli = runCli(['--files', 'README.md'], { CI_EVENT: 'pull_request' });
		assert.equal(cli.status, 0);
		assert.match(cli.stderr, /^ci-scope: diff-aware, 1 changed files vs origin\/main/);
		const parsed = JSON.parse(cli.stdout);
		assert.equal(parsed.allAffected, false);
		assert.equal(parsed.hasCodeChanges, false);
		assert.deepEqual(parsed.affectedPackages, []);
		assert.equal(parsed.turboFilter, '');
		assert.equal(parsed.changedFiles, 1);
		assert.equal(parsed.prettierFiles, '');
		assert.equal(parsed.hasStories, false);
		assert.match(cli.githubOutput, /has_code_changes=false/);
	});

	it('derives packages with stories from apps/storybook config globs', () => {
		const storyPkgs = loadStoryPackages();
		assert.ok(storyPkgs.includes('@sveltesentio/storybook'));
		assert.ok(storyPkgs.includes('@sveltesentio/ui'));
		assert.ok(storyPkgs.includes('@sveltesentio/charts'));
		assert.ok(storyPkgs.includes('@sveltesentio/flow'));
		assert.ok(storyPkgs.includes('@sveltesentio/media'));
		assert.ok(!storyPkgs.includes('@sveltesentio/collab'));
	});

	it('identifies full CI events vs pull_request via isFullEvent', () => {
		assert.equal(isFullEvent('push'), true);
		assert.equal(isFullEvent('schedule'), true);
		assert.equal(isFullEvent('workflow_dispatch'), true);
		assert.equal(isFullEvent('merge_group'), true);
		assert.equal(isFullEvent('pull_request'), false);
		assert.equal(isFullEvent(null), false);
		assert.equal(isFullEvent(undefined), false);
	});

	it('supports direct programmatic invocation via runCiAffected', async () => {
		const res = await runCiAffected({
			ciEvent: 'pull_request',
			explicitFiles: ['packages/forms/src/index.ts'],
		});
		assert.equal(res.allAffected, false);
		assert.equal(res.changedFiles, 1);
		assert.equal(res.hasStories, false);
	});

	it('resolvePrettierFiles excludes deleted and ignored files', async () => {
		const res = await resolvePrettierFiles([
			'packages/forms/src/index.ts',
			'CLAUDE.md',
			'does-not-exist.ts',
		]);
		assert.equal(res, 'packages/forms/src/index.ts');
	});
});

describe('ci-affected: resolvePrettierFiles branches', () => {
	/**
	 * Returns a temporary root directory populated with .prettierrc.json and entries.
	 * @param {Record<string, string>} entries
	 */
	function makePrettierRoot(entries) {
		const dir = mkdtempSync(join(tmpdir(), 'ci-prettier-'));
		writeFileSync(join(dir, '.prettierrc.json'), '{}\n');
		for (const [rel, text] of Object.entries(entries)) {
			const target = join(dir, rel);
			mkdirSync(join(target, '..'), { recursive: true });
			writeFileSync(target, text);
		}
		return dir;
	}

	it('boundary: empty files array returns empty string', async () => {
		assert.equal(await resolvePrettierFiles([]), '');
	});

	it('negative: null or undefined files returns empty string', async () => {
		assert.equal(await resolvePrettierFiles(null), '');
		assert.equal(await resolvePrettierFiles(undefined), '');
	});

	it('positive: missing .prettierignore formats files and normalizes paths', async () => {
		const dir = makePrettierRoot({
			'a.js': 'export const a = 1;\n',
			'sub/b.json': '{}\n',
		});
		try {
			const res = await resolvePrettierFiles(['./a.js', 'sub\\b.json'], dir);
			assert.equal(res, 'a.js sub/b.json');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('negative: present .prettierignore excludes ignored files', async () => {
		const dir = makePrettierRoot({
			'.prettierignore': 'ignored.js\n',
			'ignored.js': 'export const x = 1;\n',
			'kept.js': 'export const y = 2;\n',
		});
		try {
			const res = await resolvePrettierFiles(['ignored.js', 'kept.js'], dir);
			assert.equal(res, 'kept.js');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('negative: file with null inferredParser is excluded', async () => {
		const dir = makePrettierRoot({
			'blob.unknownext': 'raw bytes\n',
			'kept.js': 'export const z = 3;\n',
		});
		try {
			assert.equal(await resolvePrettierFiles(['blob.unknownext'], dir), '');
			assert.equal(await resolvePrettierFiles(['blob.unknownext', 'kept.js'], dir), 'kept.js');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('negative: getFileInfo ENOENT and ENOTDIR errors are skipped', async () => {
		const enoent = () => Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }));
		const enotdir = () => Promise.reject(Object.assign(new Error('bad'), { code: 'ENOTDIR' }));
		assert.equal(await isPrettierHandled(enoent, '/x/a.js', 'a.js', undefined), false);
		assert.equal(await isPrettierHandled(enotdir, '/x/a.js', 'a.js', undefined), false);
	});

	it('negative: unexpected getFileInfo error rethrows with cause', async () => {
		const dir = makePrettierRoot({
			'.prettierrc.json': '{ invalid json',
			'a.js': 'export const a = 1;\n',
		});
		try {
			await assert.rejects(
				() => resolvePrettierFiles(['a.js'], dir),
				/ci-affected: prettier getFileInfo failed for a\.js:/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		const rawFail = () => Promise.reject('raw-boom');
		let caught;
		try {
			await isPrettierHandled(rawFail, '/x/a.js', 'a.js', undefined);
		} catch (error) {
			caught = error;
		}
		assert.ok(caught instanceof Error);
		assert.equal(caught.message, 'ci-affected: prettier getFileInfo failed for a.js: raw-boom');
		assert.equal(caught.cause, 'raw-boom');
	});

	it('positive: pickPrettierGetFileInfo reads named or default export', () => {
		const stub = async () => ({ ignored: false, inferredParser: 'babel' });
		assert.equal(pickPrettierGetFileInfo({ getFileInfo: stub }), stub);
		assert.equal(pickPrettierGetFileInfo({ default: { getFileInfo: stub } }), stub);
		assert.equal(pickPrettierGetFileInfo({}), undefined);
	});
});

describe('ci-affected: runCiAffected branches', () => {
	const ENV_KEYS = ['CI_EVENT', 'GITHUB_OUTPUT', 'BASE_REF', 'HEAD_REF'];

	/**
	 * Runs `fn` with isolated CI env vars and returns its result.
	 * @template T
	 * @param {Record<string, string | undefined>} overrides
	 * @param {(stderrLines: string[]) => Promise<T>} fn
	 * @returns {Promise<T>}
	 */
	async function withCiEnv(overrides, fn) {
		const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
		const stderrLines = [];
		const origWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk) => {
			stderrLines.push(String(chunk));
			return true;
		};
		for (const key of ENV_KEYS) {
			if (overrides[key] === undefined) delete process.env[key];
			else process.env[key] = overrides[key];
		}
		try {
			return await fn(stderrLines);
		} finally {
			process.stderr.write = origWrite;
			for (const [key, val] of saved) {
				if (val === undefined) delete process.env[key];
				else process.env[key] = val;
			}
		}
	}

	it('positive: full event branch runs for each accepted CI event', async () => {
		for (const event of ['push', 'schedule', 'workflow_dispatch', 'merge_group']) {
			await withCiEnv({}, async (stderrLines) => {
				const res = await runCiAffected({
					ciEvent: event,
					baseRef: 'refs/heads/no-such-branch',
				});
				assert.equal(res.allAffected, true);
				assert.equal(res.hasCodeChanges, true);
				assert.equal(res.changedFiles, 0);
				assert.equal(res.prettierFiles, '');
				assert.equal(res.hasStories, true);
				assert.equal(res.turboFilter, '');
				assert.equal(stderrLines.at(-1), `ci-scope: full (${event} event)\n`);
			});
		}
	});

	it('positive and boundary: explicitFiles array skips git diff', async () => {
		await withCiEnv({}, async () => {
			const one = await runCiAffected({
				ciEvent: 'pull_request',
				baseRef: 'refs/heads/no-such-branch',
				explicitFiles: ['packages/forms/src/index.ts'],
			});
			assert.equal(one.changedFiles, 1);
			assert.deepEqual(one.affectedPackages, ['@sveltesentio/forms']);

			const empty = await runCiAffected({
				ciEvent: 'pull_request',
				baseRef: 'refs/heads/no-such-branch',
				explicitFiles: [],
			});
			assert.equal(empty.changedFiles, 0);
			assert.equal(empty.hasCodeChanges, false);
			assert.deepEqual(empty.affectedPackages, []);
		});
	});

	it('negative: explicitFiles null or undefined takes git diff branch', async () => {
		await withCiEnv({}, async () => {
			for (const explicitFiles of [null, undefined]) {
				const ok = await runCiAffected({
					ciEvent: 'pull_request',
					baseRef: 'HEAD',
					headRef: 'HEAD',
					explicitFiles,
				});
				assert.equal(ok.changedFiles, 0);

				const badOpts = {
					ciEvent: 'pull_request',
					baseRef: 'refs/heads/no-such-branch',
					explicitFiles,
				};
				await assert.rejects(
					() => runCiAffected(badOpts),
					/ci-affected: git diff refs\/heads\/no-such-branch\.\.\.HEAD failed/,
				);
			}
		});
	});

	it('positive: allAffected skips prettier and sets hasStories true', async () => {
		await withCiEnv({}, async () => {
			const res = await runCiAffected({
				ciEvent: 'pull_request',
				explicitFiles: ['package.json'],
			});
			assert.equal(res.allAffected, true);
			assert.equal(res.prettierFiles, '');
			assert.equal(res.hasStories, true);
			const emptyAll = { allAffected: true, affectedPackages: [] };
			assert.equal(hasAffectedStories(emptyAll, root), true);
		});
	});

	it('positive and negative: package with and without stories sets hasStories', async () => {
		await withCiEnv({}, async () => {
			const withStories = await runCiAffected({
				ciEvent: 'pull_request',
				explicitFiles: ['packages/ui/src/index.ts'],
			});
			assert.equal(withStories.allAffected, false);
			assert.equal(withStories.hasStories, true);

			const withoutStories = await runCiAffected({
				ciEvent: 'pull_request',
				explicitFiles: ['packages/forms/src/index.ts'],
			});
			assert.equal(withoutStories.allAffected, false);
			assert.equal(withoutStories.hasStories, false);
		});
	});

	it('positive and negative: githubOutput writes when set and skips when unset', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-gh-out-'));
		const outFile = join(dir, 'github_output');
		writeFileSync(outFile, '');
		try {
			await withCiEnv({}, async () => {
				await runCiAffected({
					ciEvent: 'pull_request',
					explicitFiles: ['packages/forms/src/index.ts'],
				});
				assert.equal(readFileSync(outFile, 'utf8'), '');

				await runCiAffected({
					ciEvent: 'pull_request',
					explicitFiles: ['packages/forms/src/index.ts'],
					githubOutput: outFile,
				});
				const written = readFileSync(outFile, 'utf8');
				assert.match(written, /all_affected=false/);
				assert.match(written, /changed_files=1/);
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('positive: option defaults read env vars when options omit them', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-env-defaults-'));
		const outFile = join(dir, 'github_output');
		writeFileSync(outFile, '');
		try {
			const envPush = { CI_EVENT: 'schedule', GITHUB_OUTPUT: outFile };
			await withCiEnv(envPush, async (stderrLines) => {
				const res = await runCiAffected();
				assert.equal(res.allAffected, true);
				assert.equal(stderrLines.at(-1), 'ci-scope: full (schedule event)\n');
				assert.match(readFileSync(outFile, 'utf8'), /all_affected=true/);
			});

			await withCiEnv({ BASE_REF: 'refs/heads/env-base' }, async (stderrLines) => {
				await runCiAffected({ ciEvent: 'pull_request', explicitFiles: [] });
				const expected = 'ci-scope: diff-aware, 0 changed files vs refs/heads/env-base\n';
				assert.equal(stderrLines.at(-1), expected);
			});

			await withCiEnv({ BASE_REF: 'HEAD', HEAD_REF: 'refs/heads/env-head' }, async () => {
				await assert.rejects(
					() => runCiAffected({ ciEvent: 'pull_request' }),
					/ci-affected: git diff HEAD\.\.\.refs\/heads\/env-head failed/,
				);
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('boundary: option defaults use fallbacks when options and env are unset', async () => {
		await withCiEnv({}, async (stderrLines) => {
			const res = await runCiAffected({
				explicitFiles: ['packages/forms/src/index.ts'],
			});
			assert.equal(res.allAffected, false);
			assert.equal(res.prettierFiles, 'packages/forms/src/index.ts');
			const expected = 'ci-scope: diff-aware, 1 changed files vs origin/main\n';
			assert.equal(stderrLines.at(-1), expected);

			await assert.rejects(
				() => runCiAffected({ baseRef: 'refs/heads/no-such-base' }),
				/ci-affected: git diff refs\/heads\/no-such-base\.\.\.HEAD failed/,
			);
		});
	});

	it('positive: explicit rootDir and readers options override defaults', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-rootdir-'));
		writeFileSync(join(dir, '.prettierrc.json'), '{}\n');
		writeFileSync(join(dir, '.prettierignore'), 'README.md\n');
		writeFileSync(join(dir, 'README.md'), '# doc\n');
		try {
			await withCiEnv({}, async () => {
				const res = await runCiAffected({
					rootDir: dir,
					ciEvent: 'pull_request',
					explicitFiles: ['README.md'],
					readers: [{ glob: 'README.md', pkg: '@sveltesentio/forms' }],
				});
				assert.deepEqual(res.affectedPackages, ['@sveltesentio/forms']);
				assert.equal(res.prettierFiles, '');
				assert.equal(res.hasStories, false);
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
