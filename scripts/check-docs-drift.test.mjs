// End-to-end runs of scripts/check-docs-drift.mjs on a throwaway git repository:
// the git plumbing, the exit codes and the opt-out. The pure functions are
// covered in packages/testing/test/docs-drift.test.ts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { runDocsDrift } from './check-docs-drift.mjs';

/** @type {string} */
let repo;

/** @param {string[]} args */
function git(...args) {
	return execFileSync(
		'git',
		['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
		{ cwd: repo, encoding: 'utf8', timeout: 30_000 },
	).trim();
}

/** @param {Record<string, string>} files @returns {Promise<string>} the new commit */
async function commit(files) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(repo, path)), { recursive: true });
		await writeFile(join(repo, path), content);
	}
	git('add', '-A');
	git('commit', '-q', '-m', 'fixture');
	return git('rev-parse', 'HEAD');
}

const manifest = (/** @type {Record<string, string>} */ exportsField) =>
	JSON.stringify({ name: '@fixture/demo', exports: exportsField });

describe('check-docs-drift on a git repository', () => {
	/** @type {string} */
	let base;

	before(async () => {
		repo = await mkdtemp(join(tmpdir(), 'docs-drift-'));
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 'fixture@example.invalid');
		git('config', 'user.name', 'fixture');
		base = await commit({
			'packages/demo/package.json': manifest({ '.': './src/index.js' }),
			'packages/demo/README.md': '# demo\n',
			'packages/demo/src/index.js': '',
		});
	});
	after(async () => {
		await rm(repo, { recursive: true, force: true });
	});
	beforeEach(() => {
		git('checkout', '-q', '--detach', base);
		mock.restoreAll();
	});

	it('fails when a package adds an entry point without its README', async () => {
		const head = await commit({
			'packages/demo/package.json': manifest({ '.': './src/index.js', './extra': './src/x.js' }),
			'packages/demo/src/x.js': '',
		});
		const error = mock.method(console, 'error', () => {});
		assert.equal(runDocsDrift({ cwd: repo, base, head, prBody: '' }), 1);
		const output = error.mock.calls.map((call) => String(call.arguments[0])).join('\n');
		assert.match(output, /demo: added \.\/extra with no edit to packages\/demo\/README\.md/);
	});

	it('fails when a package removes an entry point without its README', async () => {
		const head = await commit({ 'packages/demo/package.json': manifest({}) });
		mock.method(console, 'error', () => {});
		assert.equal(runDocsDrift({ cwd: repo, base, head, prBody: '' }), 1);
	});

	it('passes when the README changes with the entry point', async () => {
		const head = await commit({
			'packages/demo/package.json': manifest({ '.': './src/index.js', './extra': './src/x.js' }),
			'packages/demo/README.md': '# demo\n\n`./extra` does x.\n',
		});
		mock.method(console, 'log', () => {});
		assert.equal(runDocsDrift({ cwd: repo, base, head, prBody: '' }), 0);
	});

	it('passes when only the file behind an entry point changes', async () => {
		const head = await commit({ 'packages/demo/src/index.js': 'export {};\n' });
		mock.method(console, 'log', () => {});
		assert.equal(runDocsDrift({ cwd: repo, base, head, prBody: '' }), 0);
	});

	it('passes on the opt-out phrase in the pull request body', async () => {
		const head = await commit({ 'packages/demo/package.json': manifest({}) });
		mock.method(console, 'log', () => {});
		assert.equal(runDocsDrift({ cwd: repo, base, head, prBody: 'no docs needed: internal' }), 0);
	});

	// Boundary: no revision to compare is an error, never a pass.
	it('returns 2 when a revision is not given', () => {
		mock.method(console, 'error', () => {});
		assert.equal(runDocsDrift({ cwd: repo, base: '', head: base, prBody: '' }), 2);
		assert.equal(runDocsDrift({ cwd: repo, base, head: '', prBody: '' }), 2);
	});

	it('throws when the base commit is not in the checkout', () => {
		const absent = '0123456789abcdef0123456789abcdef01234567';
		assert.throws(() => runDocsDrift({ cwd: repo, base: absent, head: base, prBody: '' }));
	});
});
