import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	DOCS_ONLY_PATTERNS,
	PACKAGE_DIRECTORY_MAP,
	SHARED_SURFACE_PATTERNS,
	analyzeChanges,
	getGitDiffFiles,
} from './ci-affected.mjs';

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

	it('returns docs-only impact when only documentation files change', () => {
		const res = analyzeChanges(['docs/principles.md', 'README.md']);
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
			'commitlint.config.js',
			'Makefile',
			'.github/workflows/ci.yml',
			'scripts/ci-affected.mjs',
			'packages/core/src/index.ts',
			'packages/testing/src/index.ts',
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
			const res = analyzeChanges([file]);
			assert.equal(res.allAffected, false);
			assert.equal(res.hasCodeChanges, false);
		}
	});
});

describe('ci-affected: getGitDiffFiles', () => {
	it('lists the files that differ between two refs', () => {
		const files = getGitDiffFiles('HEAD', 'HEAD');
		assert.deepEqual(files, []);
	});

	it('never hands a ref to a shell', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-'));
		try {
			const files = getGitDiffFiles(`HEAD; touch ${join(dir, 'ran')} #`, 'HEAD');
			assert.ok(Array.isArray(files));
			assert.deepEqual(readdirSync(dir), [], 'the ref was executed as a shell command');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('does not read a ref that starts with a dash as a git option', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ci-affected-'));
		try {
			const files = getGitDiffFiles(`--output=${join(dir, 'written')}`, 'HEAD');
			assert.ok(Array.isArray(files));
			assert.deepEqual(readdirSync(dir), [], 'the ref was read as a git option');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
