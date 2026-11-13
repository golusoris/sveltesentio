import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { GIT_TIMEOUT_MS, MESSAGE_BYTES, gitOutput } from './check-commit-message.mjs';
import {
	MAX_COMMITS,
	PUSH_INPUT_BYTES,
	PUSH_LINE_RE,
	STDIN_TIMEOUT_MS,
	destinationExclusion,
	judgeCommits,
	main,
	parsePushLines,
	pushedCommits,
	readInput,
	storedMessage,
} from './check-pushed-commits.mjs';

const root = mkdtempSync(join(tmpdir(), 'pushed-commits-'));
after(() => rmSync(root, { recursive: true, force: true }));
const script = fileURLToPath(new URL('./check-pushed-commits.mjs', import.meta.url));
const commitScript = fileURLToPath(new URL('./check-commit-message.mjs', import.meta.url));
const email = 'person@example.org';
const signed = `chore: fixture\n\nSigned-off-by: A Person <${email}>\n`;
const zeros = '0'.repeat(40);
// Preserve both config barriers; inherited Git overrides must never reach a fixture.
const env = {
	...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
	GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_AUTHOR_NAME: 'A Person',
	GIT_AUTHOR_EMAIL: email,
	GIT_COMMITTER_NAME: 'A Person',
	GIT_COMMITTER_EMAIL: email,
};

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [gitEnv]
 * @param {string} [input]
 */
function runGit(cwd, args, gitEnv = env, input) {
	return spawnSync('git', args, {
		cwd,
		env: gitEnv,
		input,
		encoding: 'utf8',
		timeout: GIT_TIMEOUT_MS,
		maxBuffer: MESSAGE_BYTES + 1,
	});
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
	const result = runGit(cwd, args);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trimEnd();
}

/** @returns {{ cwd: string, remote: string }} */
function repository() {
	const cwd = mkdtempSync(join(root, 'repo-'));
	const template = join(cwd, 'empty-template');
	const remote = join(cwd, 'remote.git');
	mkdirSync(template);
	git(cwd, ['init', '--initial-branch=main', `--template=${template}`]);
	git(cwd, ['init', '--bare', '--initial-branch=main', `--template=${template}`, remote]);
	git(cwd, ['remote', 'add', 'origin', remote]);
	return { cwd, remote };
}

/** @param {string} cwd @param {string} [message] @param {boolean} [signOff] */
function commit(cwd, message = 'chore: fixture', signOff = true) {
	const args = ['commit', '--allow-empty', '-m', message];
	if (signOff) args.push('-s');
	git(cwd, args);
	return git(cwd, ['rev-parse', 'HEAD']);
}

/** @param {string} cwd @returns {string} */
function unsignedForkCommit(cwd) {
	const fork = join(cwd, 'fork.git');
	git(cwd, ['init', '--bare', `--template=${join(cwd, 'empty-template')}`, fork]);
	git(cwd, ['remote', 'add', 'fork', fork]);
	const unsigned = commit(cwd, 'chore: unsigned fork root', false);
	git(cwd, ['push', 'fork', 'main']);
	git(cwd, ['fetch', 'fork']);
	return unsigned;
}

/** @param {string} local @param {string} [remote] */
function pushLine(local, remote = zeros) {
	return `refs/heads/main ${local} refs/heads/main ${remote}\n`;
}

/** @param {string} cwd @param {string} input @param {string[]} [argv] */
function check(cwd, input, argv = []) {
	return main(argv, { cwd, env, stdin: Readable.from([Buffer.from(input)]) });
}

/** @param {string} cwd @param {string} name @param {string} target */
function installHook(cwd, name, target) {
	const hooks = join(cwd, `${name}-hooks`);
	mkdirSync(hooks);
	writeFileSync(
		join(hooks, name),
		`#!/bin/sh\nexec node "${target.replaceAll('\\', '/')}" "$@"\n`,
		{ mode: 0o755 },
	);
	return ['-c', `core.hooksPath=${hooks}`];
}

test('parsePushLines accepts creates, updates, deletes, sha256 and one trailing newline', () => {
	const local = 'a'.repeat(40);
	const remote = 'b'.repeat(40);
	const cases = [
		[pushLine(local).trimEnd(), [{ local, remote: '' }]],
		[pushLine(local, remote), [{ local, remote }]],
		[`(delete) ${zeros} refs/heads/topic ${remote}\n`, []],
		[pushLine('a'.repeat(64), '0'.repeat(64)), [{ local: 'a'.repeat(64), remote: '' }]],
		[pushLine(local), [{ local, remote: '' }]],
		['', []],
	];
	for (let index = 0; index < cases.length; index++) {
		assert.deepEqual(parsePushLines(cases[index][0]), cases[index][1]);
	}
	assert.ok(PUSH_LINE_RE.test(pushLine(local).trimEnd()));
	assert.deepEqual(parsePushLines(pushLine(local) + pushLine(remote)), [
		{ local, remote: '' },
		{ local: remote, remote: '' },
	]);
});

test('parsePushLines refuses malformed oids, extra fields and interior empty lines', () => {
	assert.throws(
		() => parsePushLines('refs/heads/a 123 refs/heads/a 000'),
		/Malformed pre-push line 1/,
	);
	assert.throws(() => parsePushLines(`${pushLine('a'.repeat(40)).trimEnd()} extra`), /Malformed/);
	assert.throws(() => parsePushLines(`${pushLine('a'.repeat(40))}\n`), /Malformed pre-push line 2/);
	assert.throws(() => parsePushLines(`\n${pushLine('a'.repeat(40))}`), /Malformed pre-push line 1/);
});

test('readInput decodes buffers and accepts its exact byte boundary', async () => {
	assert.equal(PUSH_INPUT_BYTES, 1_048_576);
	assert.equal(STDIN_TIMEOUT_MS, 10_000);
	assert.equal(await readInput(Readable.from([Buffer.from('hello')])), 'hello');
	assert.equal(await readInput(Readable.from([Buffer.from('four')]), { bytes: 4 }), 'four');
});

test('readInput refuses oversized input and destroys its stream', async () => {
	const stream = Readable.from([Buffer.from('12345')]);
	await assert.rejects(readInput(stream, { bytes: 4 }), /exceeds 4 bytes/);
	assert.equal(stream.destroyed, true);
});

test('readInput refuses a never-ending stream and destroys it on timeout', async () => {
	const stream = new PassThrough();
	await assert.rejects(readInput(stream, { timeoutMs: 50 }), /not closed within 50 ms/);
	assert.equal(stream.destroyed, true);
});

test('readInput refuses invalid UTF-8 and stream errors', async () => {
	await assert.rejects(readInput(Readable.from([Buffer.from([0xc3, 0x28])])), /encoded/);
	const stream = new PassThrough();
	const result = readInput(stream);
	stream.destroy(new Error('fixture stream failed'));
	await assert.rejects(result, /fixture stream failed/);
});

const editorModes = ['verbatim', 'whitespace'];
for (let index = 0; index < editorModes.length; index++) {
	const mode = editorModes[index];
	test(`planted ${mode} editor commit lands past commit-msg; pre-push refuses it`, async (t) => {
		const errors = t.mock.method(console, 'error', () => {});
		const { cwd } = repository();
		const file = join(cwd, 'message.txt');
		writeFileSync(file, `chore: four\n\n# Conflicts:\n#\tf.txt\n\nSigned-off-by: A <${email}>\n`);
		const hook = installHook(cwd, 'commit-msg', commitScript);
		const result = runGit(
			cwd,
			[...hook, 'commit', '--allow-empty', '-e', `--cleanup=${mode}`, '-F', file],
			{ ...env, GIT_EDITOR: 'true' },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stderr);
		assert.match(git(cwd, ['log', '-1', '--format=%B']), /^# Conflicts:/m);
		const sha = git(cwd, ['rev-parse', 'HEAD']);
		assert.equal(await check(cwd, pushLine(sha)), 1);
		const output = errors.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
		assert.ok(output.includes(`${sha.slice(0, 12)}: Leftover # line`));
		assert.match(output, /Fix: git rebase -i --exec/);
	});
}

test('pre-push refuses missing and mismatched sign-offs', async (t) => {
	const errors = t.mock.method(console, 'error', () => {});
	const { cwd } = repository();
	const unsigned = commit(cwd, 'chore: unsigned', false);
	assert.equal(await check(cwd, pushLine(unsigned)), 1);
	assert.match(errors.mock.calls[0].arguments[0], /Missing Signed-off-by/);
	errors.mock.resetCalls();
	const mismatch = commit(
		cwd,
		'chore: mismatch\n\nSigned-off-by: Other <other@example.org>',
		false,
	);
	assert.equal(await check(cwd, pushLine(mismatch, unsigned)), 1);
	assert.match(errors.mock.calls[0].arguments[0], /must name the committer email/);
});

test('clean signed range of two commits on a new branch passes', async () => {
	const { cwd } = repository();
	const first = commit(cwd);
	const head = commit(cwd, 'chore: child');
	assert.deepEqual(
		new Set(pushedCommits([{ local: head, remote: '' }], cwd, env)),
		new Set([first, head]),
	);
	assert.deepEqual(judgeCommits([first, head], cwd, env), []);
	assert.equal(await check(cwd, pushLine(head)), 0);
});

test('commits already reachable from remote-tracking refs are not judged', async () => {
	const { cwd, remote } = repository();
	const first = commit(cwd, 'chore: unsigned root', false);
	git(cwd, ['push', 'origin', 'main']);
	git(cwd, ['fetch', 'origin']);
	const head = commit(cwd, 'chore: signed child');
	const exclusion = destinationExclusion('origin', cwd, env);
	assert.deepEqual(pushedCommits([{ local: head, remote: '' }], cwd, env, exclusion), [head]);
	assert.equal(await check(cwd, pushLine(head, first), ['origin', remote]), 0);
	// A new branch has no known remote oid: only main's destination argument bounds the root.
	assert.equal(await check(cwd, pushLine(head), ['origin', remote]), 0);
});

test("commits held only by another remote's tracking refs are judged", async (t) => {
	t.mock.method(console, 'error', () => {});
	const { cwd, remote } = repository();
	const unsigned = unsignedForkCommit(cwd);
	const exclusion = destinationExclusion('origin', cwd, env);
	assert.deepEqual(exclusion, ['--not', '--remotes=origin']);
	assert.deepEqual(pushedCommits([{ local: unsigned, remote: '' }], cwd, env, exclusion), [
		unsigned,
	]);
	// Red on 331fe01: --not --remotes dropped this commit and check returned 0.
	assert.equal(await check(cwd, pushLine(unsigned), ['origin', remote]), 1);
});

test('URL push judges without tracking exclusion', async (t) => {
	const errors = t.mock.method(console, 'error', () => {});
	const { cwd, remote } = repository();
	const first = commit(cwd, 'chore: unsigned root', false);
	git(cwd, ['push', 'origin', 'main']);
	git(cwd, ['fetch', 'origin']);
	const head = commit(cwd, 'chore: signed child');
	assert.deepEqual(destinationExclusion(remote, cwd, env), []);
	assert.equal(await check(cwd, pushLine(head), [remote, remote]), 1);
	const output = errors.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
	assert.match(output, /No remote-tracking refs of a configured destination/);
	assert.equal(await check(cwd, pushLine(head, first), [remote, remote]), 0);
});

test('ambiguous or unknown remote names fall back to strict judging', () => {
	const { cwd, remote } = repository();
	git(cwd, ['config', 'remote.a.url', remote]);
	git(cwd, ['config', 'remote.a/b.url', remote]);
	assert.deepEqual(destinationExclusion('a', cwd, env), []);
	assert.deepEqual(destinationExclusion('a/b', cwd, env), []);
	assert.deepEqual(destinationExclusion('nope', cwd, env), []);
	assert.deepEqual(destinationExclusion('', cwd, env), []);
});

test('known remote oid excludes ancestors without a remote-tracking ref', async () => {
	const { cwd, remote } = repository();
	const first = commit(cwd, 'chore: unsigned root', false);
	git(cwd, ['push', remote, 'main']);
	git(cwd, ['update-ref', '-d', 'refs/remotes/origin/main']);
	assert.equal(git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/remotes']), '');
	const head = commit(cwd, 'chore: signed child');
	assert.deepEqual(pushedCommits([{ local: head, remote: first }], cwd, env), [head]);
	assert.equal(await check(cwd, pushLine(head, first)), 0);
});

test('unknown remote oid is not excluded', async () => {
	const { cwd } = repository();
	const head = commit(cwd);
	const unknown = 'f'.repeat(40);
	assert.equal(
		gitOutput(
			['rev-parse', '--verify', '--quiet', `${unknown}^{commit}`],
			cwd,
			env,
			undefined,
			true,
		),
		undefined,
	);
	assert.deepEqual(pushedCommits([{ local: head, remote: unknown }], cwd, env), [head]);
	assert.equal(await check(cwd, pushLine(head, unknown)), 0);
});

test('delete-only and empty input pass without spawning Git', async () => {
	const missing = join(root, 'not-a-repository');
	assert.deepEqual(pushedCommits([], missing, env), []);
	assert.equal(await check(missing, `(delete) ${zeros} refs/heads/topic ${'a'.repeat(40)}\n`), 0);
	assert.equal(await check(missing, ''), 0);
});

test('malformed stdin and three arguments fail closed with status 2', async (t) => {
	const errors = t.mock.method(console, 'error', () => {});
	const { cwd } = repository();
	assert.equal(await check(cwd, 'bad line'), 2);
	assert.match(errors.mock.calls[0].arguments[0], /Cannot judge pushed commits: Malformed/);
	assert.equal(await check(cwd, '', ['origin', 'url', 'extra']), 2);
	assert.match(errors.mock.calls.at(-1).arguments[0], /Usage:/);
});

/** @param {string} cwd */
function importTooManyCommits(cwd) {
	let input = '';
	for (let index = 0; index < MAX_COMMITS + 1; index++) {
		const message = `chore: fixture ${index}\n\nSigned-off-by: A Person <${email}>\n`;
		input += `commit refs/heads/main\ncommitter A Person <${email}> 0 +0000\n`;
		input += `data ${Buffer.byteLength(message)}\n${message}\n`;
	}
	const result = runGit(cwd, ['fast-import', '--quiet'], env, input);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return git(cwd, ['rev-parse', 'HEAD']);
}

test('more than MAX_COMMITS commits fails closed before judging', async (t) => {
	const errors = t.mock.method(console, 'error', () => {});
	const { cwd } = repository();
	assert.equal(MAX_COMMITS, 1000);
	const head = importTooManyCommits(cwd);
	assert.throws(
		() => pushedCommits([{ local: head, remote: '' }], cwd, env),
		/More than 1000 commits/,
	);
	assert.equal(await check(cwd, pushLine(head)), 2);
	assert.match(errors.mock.calls[0].arguments[0], /More than 1000 commits/);
});

test('storedMessage ignores log.showSignature and uses raw committer email', async () => {
	const { cwd } = repository();
	const head = commit(cwd, 'chore: fixture');
	git(cwd, ['config', 'log.showSignature', 'true']);
	git(cwd, ['config', 'mailmap.file', join(cwd, 'mailmap')]);
	writeFileSync(join(cwd, 'mailmap'), `Mapped <mapped@example.org> A Person <${email}>\n`);
	assert.deepEqual(storedMessage(head, cwd, env), { email, message: `${signed}\n` });
	assert.equal(await check(cwd, pushLine(head)), 0);
});

test(
	'real git push runs the pre-push check',
	{ skip: process.platform === 'win32' ? 'POSIX executable shell hook required' : false },
	() => {
		const refused = repository();
		commit(refused.cwd, 'chore: unsigned', false);
		const hook = installHook(refused.cwd, 'pre-push', script);
		const result = runGit(refused.cwd, [...hook, 'push', 'origin', 'main']);
		assert.ifError(result.error);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Missing Signed-off-by/);
		assert.equal(git(refused.remote, ['for-each-ref', '--format=%(refname)']), '');
		const forked = repository();
		unsignedForkCommit(forked.cwd);
		commit(forked.cwd, 'chore: signed child');
		const forkHook = installHook(forked.cwd, 'pre-push', script);
		const forkResult = runGit(forked.cwd, [...forkHook, 'push', 'origin', 'main']);
		assert.ifError(forkResult.error);
		assert.notEqual(forkResult.status, 0);
		assert.match(forkResult.stderr, /Missing Signed-off-by/);
		assert.equal(git(forked.remote, ['for-each-ref', '--format=%(refname)']), '');
		const accepted = repository();
		const head = commit(accepted.cwd);
		const signedHook = installHook(accepted.cwd, 'pre-push', script);
		git(accepted.cwd, [...signedHook, 'push', 'origin', 'main']);
		assert.equal(git(accepted.remote, ['rev-parse', 'refs/heads/main']), head);
	},
);
