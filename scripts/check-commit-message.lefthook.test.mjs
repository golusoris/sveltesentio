import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const config = parse(readFileSync(join(cwd, 'lefthook-local.yml'), 'utf8'), { uniqueKeys: true });
const root = mkdtempSync(join(tmpdir(), 'commit-message-lefthook-'));
after(() => rmSync(root, { recursive: true, force: true }));
const globalConfig = join(root, 'global.gitconfig');
writeFileSync(globalConfig, '');
const env = {
	...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
	GIT_CONFIG_GLOBAL: globalConfig,
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_AUTHOR_NAME: 'A Person',
	GIT_AUTHOR_EMAIL: 'person@example.org',
	GIT_COMMITTER_NAME: 'A Person',
	GIT_COMMITTER_EMAIL: 'person@example.org',
};

test('commit-msg job quotes raw Lefthook argument with a literal heredoc', () => {
	assert.ok(config['commit-msg']);
	assert.equal(Object.keys(config['commit-msg'].commands).length, 1);
	const run = config['commit-msg'].commands['sign-off'].run;
	assert.match(run, /<<'GIT_ARGUMENT'/);
	assert.match(run, /^IFS= read -r MESSAGE_FILE <<'GIT_ARGUMENT'\n\{1\}\nGIT_ARGUMENT\n/);
	assert.doesNotMatch(run, /\$\(/);
	assert.match(run, /node scripts\/check-commit-message\.mjs "\$MESSAGE_FILE"/);
});

test(
	'commit-msg heredoc preserves hostile path (win32 skip: quote characters in filenames)',
	{ skip: process.platform === 'win32' ? 'Windows filenames cannot contain double quotes' : false },
	(t) => {
		const root = mkdtempSync(join(tmpdir(), 'commit-message-\'"$(touch pwned)`touch pwned`-'));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		assert.equal(existsSync(join(cwd, 'pwned')), false);
		const path = join(root, 'message.txt');
		const run = config['commit-msg'].commands['sign-off'].run.replaceAll('{1}', path);
		writeFileSync(path, 'chore: x\n\nSigned-off-by: A Person <person@example.org>\n');
		const signed = runShell(run);
		assert.ifError(signed.error);
		assert.equal(signed.status, 0, signed.stderr);
		assertNoMarker(root);
		writeFileSync(path, 'chore: x\n');
		const unsigned = runShell(run);
		assert.ifError(unsigned.error);
		assert.equal(unsigned.status, 1, unsigned.stderr);
		assert.match(unsigned.stderr, /Missing Signed-off-by/);
		assertNoMarker(root);
	},
);

/** @param {string} run */
function runShell(run) {
	// Execute the actual hook text: the shell is the interface under test.
	return spawnSync('sh', ['-c', run], {
		cwd,
		env,
		encoding: 'utf8',
		timeout: 10_000,
		maxBuffer: 262145,
	});
}

/** @param {string} root */
function assertNoMarker(root) {
	const paths = readdirSync(root, { recursive: true, encoding: 'utf8' });
	assert.equal(
		paths.some((path) => basename(path) === 'pwned'),
		false,
	);
	assert.equal(existsSync(join(cwd, 'pwned')), false);
}

test('pre-push job feeds Git stdin to the stored-commit check', () => {
	const command = config['pre-push'].commands['commit-messages'];
	assert.equal(command.use_stdin, true);
	assert.equal(command.run, 'node scripts/check-pushed-commits.mjs');
	assert.doesNotMatch(command.run, /\{/);
});

test(
	'commit-msg heredoc fails closed on a newline path',
	{ skip: process.platform === 'win32' ? 'Newline not allowed in Windows filenames' : false },
	() => {
		const directory = join(root, 'a\nb');
		mkdirSync(directory);
		const path = join(directory, 'message.txt');
		writeFileSync(path, 'chore: x\n\nSigned-off-by: A Person <person@example.org>\n');
		const run = config['commit-msg'].commands['sign-off'].run.replaceAll('{1}', path);
		const result = runShell(run);
		assert.ifError(result.error);
		assert.equal(result.status, 2, result.stderr);
		assert.match(result.stderr, /Cannot judge commit message/);
		assertNoMarker(root);
	},
);
