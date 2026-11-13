import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CUT_LINE,
	GIT_TIMEOUT_MS,
	MESSAGE_BYTES,
	commentPrefix,
	commentsSurvive,
	committerEmail,
	cutLine,
	judgeMessage,
	main,
	readMessageFile,
	signOffEmails,
	truncatesAtCut,
} from './check-commit-message.mjs';

const root = mkdtempSync(join(tmpdir(), 'commit-message-'));
after(() => rmSync(root, { recursive: true, force: true }));
const globalConfig = join(root, 'global.gitconfig');
writeFileSync(globalConfig, '');
const script = fileURLToPath(new URL('./check-commit-message.mjs', import.meta.url));
const email = 'person@example.org';
const signed = `chore: x\n\nSigned-off-by: A Person <${email}>\n`;
// Preserve both config barriers; inherited Git overrides must never reach a fixture.
const env = {
	...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
	GIT_CONFIG_GLOBAL: globalConfig,
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_AUTHOR_NAME: 'A Person',
	GIT_AUTHOR_EMAIL: email,
	GIT_COMMITTER_NAME: 'A Person',
	GIT_COMMITTER_EMAIL: email,
};

/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [gitEnv] */
function runGit(cwd, args, gitEnv = env) {
	return spawnSync('git', args, {
		cwd,
		env: gitEnv,
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

/** @returns {string} */
function repository() {
	const cwd = mkdtempSync(join(root, 'repo-'));
	const template = join(cwd, 'empty-template');
	mkdirSync(template);
	git(cwd, ['init', '--initial-branch=main', `--template=${template}`]);
	return cwd;
}

/** @param {string} cwd @param {string | Buffer} message @returns {string} */
function messageFile(cwd, message) {
	const path = join(cwd, 'message.txt');
	writeFileSync(path, message);
	return path;
}

/** @param {string} cwd @param {string} content */
function commitContent(cwd, content) {
	writeFileSync(join(cwd, 'conflict.txt'), content);
	git(cwd, ['add', 'conflict.txt']);
	git(cwd, ['commit', '-s', '-m', 'chore: fixture']);
}

/** @param {string} cwd */
function conflictedMerge(cwd) {
	commitContent(cwd, 'base\n');
	git(cwd, ['branch', 'topic']);
	commitContent(cwd, 'main\n');
	git(cwd, ['checkout', 'topic']);
	commitContent(cwd, 'topic\n');
	git(cwd, ['checkout', 'main']);
	const result = runGit(cwd, ['merge', 'topic']);
	assert.ifError(result.error);
	assert.equal(result.status, 1, result.stderr);
	assert.match(readFileSync(join(cwd, 'conflict.txt'), 'utf8'), /^<<<<<<< /m);
	writeFileSync(join(cwd, 'conflict.txt'), 'resolved\n');
	git(cwd, ['add', 'conflict.txt']);
}

/** @param {string} cwd @returns {string[]} */
function installHook(cwd) {
	const hooks = join(cwd, 'test-hooks');
	mkdirSync(hooks);
	const portableScript = script.replaceAll('\\', '/');
	writeFileSync(join(hooks, 'commit-msg'), `#!/bin/sh\nexec node "${portableScript}" "$1"\n`, {
		mode: 0o755,
	});
	return ['-c', `core.hooksPath=${hooks}`];
}

/**
 * @param {(string | null)[]} signOffs
 * @param {string} [message]
 * @param {boolean} [keep]
 * @param {{ commentPrefix?: string, truncatesAtCut?: boolean }} [extra]
 */
function judge(signOffs, message = signed, keep = false, extra = {}) {
	return judgeMessage(message, { email, signOffs, commentsSurvive: keep, ...extra });
}

test('judgeMessage accepts committer, mixed case and one matching co-signature', () => {
	assert.deepEqual(judge([email]), []);
	assert.deepEqual(judge(['PERSON@EXAMPLE.ORG']), []);
	assert.deepEqual(judge(['other@example.org', email]), []);
});

test('judgeMessage refuses missing, mismatched and malformed sign-offs', () => {
	assert.match(judge([]).join('\n'), /Missing Signed-off-by/);
	assert.match(judge(['other@example.org']).join('\n'), /committer email/);
	assert.match(judge([null, email]).join('\n'), /Malformed Signed-off-by/);
});

test('judgeMessage stops at the cut line only when Git truncates there', () => {
	assert.deepEqual(judge([email], `${signed}# Conflicts:\n`, false), []);
	assert.match(judge([email], `${signed}# Conflicts:\n`, true)[0], /line 4$/);
	assert.deepEqual(
		judge([email], `${signed}${CUT_LINE}\n# discarded\n`, true, { truncatesAtCut: true }),
		[],
	);
	assert.match(
		judge([email], `# retained\n${CUT_LINE}\n# discarded`, true, { truncatesAtCut: true })[0],
		/line 1$/,
	);
	assert.deepEqual(judge([email], `${signed} # indented\n`, true), []);
	assert.deepEqual(judge([email], `${signed}${CUT_LINE}\n# discarded\n`, true), [
		'Leftover # line at line 4',
		'Leftover # line at line 5',
	]);
	const extra = { commentPrefix: ';', truncatesAtCut: true };
	assert.deepEqual(judge([email], `# kept\n${cutLine(';')}\n# after\n`, true, extra), [
		'Leftover # line at line 1',
	]);
	assert.deepEqual(judge([email], `${CUT_LINE}\n# after\n`, true, extra), [
		'Leftover # line at line 1',
		'Leftover # line at line 2',
	]);
});

test('judgeMessage refuses # lines that a non-# comment prefix keeps', () => {
	assert.deepEqual(judge([email], `${signed}# Conflicts:\n`, false, { commentPrefix: '#' }), []);
	assert.deepEqual(judge([email], `${signed}# Conflicts:\n`, false, { commentPrefix: ';' }), [
		'Leftover # line at line 4',
	]);
	assert.deepEqual(
		judge([email], `${signed}#! stripped\n# Conflicts:\n`, false, { commentPrefix: '#!' }),
		['Leftover # line at line 5'],
	);
});

test('judgeMessage reports five # lines and the remaining count', () => {
	const five = '# one\n'.repeat(5);
	assert.equal(judge([email], five, true).length, 5);
	const six = judge([email], `${five}# six\n`, true);
	assert.equal(six.length, 6);
	assert.equal(six[4], 'Leftover # line at line 5');
	assert.equal(six[5], 'and 1 more # lines');
	assert.equal(judge([email], '# x\n'.repeat(9), true).at(-1), 'and 4 more # lines');
});

const cleanupCases = [
	[undefined, 'editor', false],
	[undefined, ':', true],
	['default', 'editor', false],
	['default', ':', true],
	['strip', ':', false],
	['strip', 'editor', false],
	['whitespace', 'editor', true],
	['whitespace', ':', true],
	['verbatim', 'editor', true],
	['verbatim', ':', true],
	['scissors', 'editor', true],
	['scissors', ':', true],
];
for (let index = 0; index < cleanupCases.length; index++) {
	const [cleanup, editor, expected] = cleanupCases[index];
	test(`commentsSurvive: cleanup=${cleanup}, GIT_EDITOR=${editor}`, () => {
		assert.equal(commentsSurvive({ GIT_EDITOR: editor }, cleanup), expected);
	});
}

test('commentsSurvive requires exactly : and refuses unknown cleanup', () => {
	assert.equal(commentsSurvive({}, undefined), false);
	assert.equal(commentsSurvive({ GIT_EDITOR: ': ' }, undefined), false);
	assert.throws(() => commentsSurvive({}, 'unknown'), /unknown commit.cleanup/);
});

const truncationCases = [
	['scissors', 'editor', true],
	['scissors', ':', false],
	['whitespace', 'editor', false],
	[undefined, 'editor', false],
	['strip', 'editor', false],
];
for (let index = 0; index < truncationCases.length; index++) {
	const [cleanup, editor, expected] = truncationCases[index];
	test(`truncatesAtCut: cleanup=${cleanup}, GIT_EDITOR=${editor}`, () => {
		assert.equal(truncatesAtCut({ GIT_EDITOR: editor }, cleanup), expected);
	});
}

test('commentPrefix reads the last comment key and maps auto to #', () => {
	const cwd = repository();
	assert.equal(commentPrefix(cwd, env), '#');
	git(cwd, ['config', 'core.commentChar', ';']);
	assert.equal(commentPrefix(cwd, env), ';');
	git(cwd, ['config', '--add', 'core.commentString', '%']);
	assert.equal(commentPrefix(cwd, env), '%');
	const reverse = repository();
	git(reverse, ['config', 'core.commentString', '%']);
	git(reverse, ['config', 'core.commentChar', ';']);
	assert.equal(commentPrefix(reverse, env), ';');
	const auto = repository();
	git(auto, ['config', 'core.commentChar', 'auto']);
	assert.equal(commentPrefix(auto, env), '#');
	const empty = repository();
	git(empty, ['config', 'core.commentChar', '']);
	assert.throws(() => commentPrefix(empty, env), /Cannot judge/);
});

test('readMessageFile accepts empty and exactly MESSAGE_BYTES, refuses one extra byte', () => {
	assert.equal(readMessageFile(messageFile(root, '')), '');
	assert.equal(
		readMessageFile(messageFile(root, Buffer.alloc(MESSAGE_BYTES, 120))).length,
		MESSAGE_BYTES,
	);
	assert.throws(
		() => readMessageFile(messageFile(root, Buffer.alloc(MESSAGE_BYTES + 1))),
		/exceeds/,
	);
});

test('readMessageFile refuses a directory, missing path and invalid UTF-8', () => {
	assert.throws(() => readMessageFile(root));
	assert.throws(() => readMessageFile(join(root, 'missing')));
	assert.throws(() => readMessageFile(messageFile(root, Buffer.from([0xc3, 0x28]))), /encoded/);
});

test(
	'readMessageFile refuses FIFO without blocking (win32 skip: no mkfifo)',
	{ skip: process.platform === 'win32' ? 'Windows has no mkfifo' : false },
	() => {
		const path = join(root, 'fifo');
		const result = spawnSync('mkfifo', [path], {
			env,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: MESSAGE_BYTES + 1,
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0);
		assert.throws(() => readMessageFile(path), /regular file/);
	},
);

test('git identity and trailer parser use committer, mixed-case keys and strict values', () => {
	const cwd = repository();
	assert.equal(committerEmail(cwd, { ...env, GIT_AUTHOR_EMAIL: 'author@example.org' }), email);
	const message = 'chore: x\n\nsIgNeD-oFf-By: A Person <PERSON@EXAMPLE.ORG>\n';
	assert.deepEqual(signOffEmails(message, cwd, env), ['PERSON@EXAMPLE.ORG']);
	assert.deepEqual(
		signOffEmails(
			'chore: x\n\nbody\n\n---\n\nmore\n\nSigned-off-by: A Person <person@example.org>\n',
			cwd,
			env,
		),
		['person@example.org'],
	);
	assert.deepEqual(signOffEmails('chore: x\n\nSigned-off-by: not-an-ident\n', cwd, env), [null]);
	assert.deepEqual(signOffEmails('chore: x\n\nSigned-off-by: <person@example.org>\n', cwd, env), [
		null,
	]);
	assert.deepEqual(
		signOffEmails('chore: x\n\nSigned-off-by: A Person<person@example.org>\n', cwd, env),
		[null],
	);
	assert.deepEqual(signOffEmails('chore: x\n\nReviewed-by: A Person <a@b>\n', cwd, env), []);
});

test('main enforces local cleanup modes and fails closed on an unknown mode', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	const path = messageFile(cwd, `${signed}# Conflicts:\n`);
	git(cwd, ['config', 'commit.cleanup', 'strip']);
	assert.equal(main([path], { cwd, env: { ...env, GIT_EDITOR: ':' } }), 0);
	git(cwd, ['config', 'commit.cleanup', 'whitespace']);
	assert.equal(main([path], { cwd, env: { ...env, GIT_EDITOR: 'editor' } }), 1);
	git(cwd, ['config', 'commit.cleanup', 'unknown']);
	assert.equal(main([path], { cwd, env }), 2);
});

test('main refuses mismatched and malformed trailers; missing committer cannot be judged', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	const other = signed.replace(email, 'other@example.org');
	assert.equal(main([messageFile(cwd, other)], { cwd, env }), 1);
	const malformed = `${signed}Signed-off-by: A Person\n`;
	assert.equal(main([messageFile(cwd, malformed)], { cwd, env }), 1);
	assert.equal(
		main([messageFile(cwd, signed)], { cwd, env: { ...env, GIT_COMMITTER_EMAIL: '' } }),
		2,
	);
});

test('main returns 2 for missing/unreadable/oversize input and git failure', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	assert.equal(main([], { cwd, env }), 2);
	assert.equal(main([join(cwd, 'missing')], { cwd, env }), 2);
	assert.equal(main([messageFile(cwd, Buffer.alloc(MESSAGE_BYTES + 1))], { cwd, env }), 2);
	assert.equal(main([messageFile(cwd, signed)], { cwd, env: { ...env, PATH: '' } }), 2);
});

test('main passes signed file, refuses unsigned file and prints fix hint', (t) => {
	const errors = t.mock.method(console, 'error', () => {});
	const cwd = repository();
	assert.equal(main([messageFile(cwd, signed)], { cwd, env }), 0);
	assert.equal(main([messageFile(cwd, 'chore: x\n')], { cwd, env }), 1);
	assert.match(errors.mock.calls.at(-1).arguments[0], /git commit -s; remove the # lines/);
});

test('planted unsigned commit lands WITHOUT hook; judge refuses its actual log text', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	git(cwd, ['commit', '--allow-empty', '-m', 'chore: x']);
	const message = git(cwd, ['log', '-1', '--format=%B']);
	assert.doesNotMatch(message, /Signed-off-by:/i);
	assert.equal(main([messageFile(cwd, message)], { cwd, env }), 1);
});

test('planted signed commit with a --- body lands; main accepts it', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	const file = messageFile(cwd, 'chore: x\n\nbody\n\n---\n\nmore\n');
	git(cwd, ['commit', '--allow-empty', '-s', '-F', file]);
	const message = git(cwd, ['log', '-1', '--format=%B']);
	assert.equal(main([messageFile(cwd, message)], { cwd, env: { ...env, GIT_EDITOR: ':' } }), 0);
});

test('planted commentChar ; strip commit keeps # lines; main refuses it', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	git(cwd, ['config', 'core.commentChar', ';']);
	git(cwd, ['config', 'commit.cleanup', 'strip']);
	const file = messageFile(
		cwd,
		'chore: x\n\n# Conflicts:\n#\tf.txt\n\nSigned-off-by: A Person <person@example.org>\n',
	);
	git(cwd, ['commit', '--allow-empty', '-F', file]);
	const message = git(cwd, ['log', '-1', '--format=%B']);
	assert.match(message, /^# Conflicts:/m);
	assert.equal(main([messageFile(cwd, message)], { cwd, env: { ...env, GIT_EDITOR: ':' } }), 1);
});

test('planted scissors commit without an editor keeps the cut; main refuses it', (t) => {
	const errors = t.mock.method(console, 'error', () => {});
	const cwd = repository();
	git(cwd, ['config', 'commit.cleanup', 'scissors']);
	const file = messageFile(
		cwd,
		`chore: y\n\nSigned-off-by: A Person <person@example.org>\n${CUT_LINE}\n# Conflicts:\n`,
	);
	git(cwd, ['commit', '--allow-empty', '-F', file]);
	const message = git(cwd, ['log', '-1', '--format=%B']);
	assert.ok(message.split('\n').includes(CUT_LINE));
	assert.match(message, /^Signed-off-by: A Person <person@example\.org>$/m);
	const path = messageFile(cwd, message);
	assert.equal(main([path], { cwd, env: { ...env, GIT_EDITOR: ':' } }), 1);
	const kept = errors.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
	assert.match(kept, /Leftover # line at line 4/);
	assert.doesNotMatch(kept, /Missing Signed-off-by/);
	errors.mock.resetCalls();
	assert.equal(main([path], { cwd, env: { ...env, GIT_EDITOR: 'editor' } }), 0);
	// With an editor Git truncates at the cut, so a sign-off below it never reaches the commit.
	const below = messageFile(
		cwd,
		`chore: y\n\n${CUT_LINE}\n# Conflicts:\n\nSigned-off-by: A Person <person@example.org>\n`,
	);
	errors.mock.resetCalls();
	assert.equal(main([below], { cwd, env: { ...env, GIT_EDITOR: 'editor' } }), 1);
	assert.equal(errors.mock.calls[0].arguments[0], 'Missing Signed-off-by trailer');
});

test('planted conflicted --no-edit merge lands WITHOUT hook and retains # lines', (t) => {
	t.mock.method(console, 'error', () => {});
	const cwd = repository();
	conflictedMerge(cwd);
	git(cwd, ['commit', '--no-edit']);
	const message = git(cwd, ['log', '-1', '--format=%B']);
	assert.match(message, /^# Conflicts:/m);
	assert.equal(main([messageFile(cwd, message)], { cwd, env: { ...env, GIT_EDITOR: ':' } }), 1);
	// Supply the missing sign-off: the independent # line barrier must still refuse it.
	const withSignOff = `${message}\n\nSigned-off-by: A Person <${email}>\n`;
	assert.equal(main([messageFile(cwd, withSignOff)], { cwd, env: { ...env, GIT_EDITOR: ':' } }), 1);
});

test('WITH hook unsigned commit refuses without moving HEAD; git commit -s passes', () => {
	const cwd = repository();
	git(cwd, ['commit', '--allow-empty', '-s', '-m', 'chore: base']);
	const head = git(cwd, ['rev-parse', 'HEAD']);
	const hook = installHook(cwd);
	const result = runGit(cwd, [...hook, 'commit', '--allow-empty', '-m', 'chore: unsigned']);
	assert.ifError(result.error);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Missing Signed-off-by/);
	assert.equal(git(cwd, ['rev-parse', 'HEAD']), head);
	git(cwd, [...hook, 'commit', '--allow-empty', '-s', '-m', 'chore: signed']);
	assert.notEqual(git(cwd, ['rev-parse', 'HEAD']), head);
});

test('WITH hook conflicted --no-edit merge refuses, including with a sign-off', () => {
	const cwd = repository();
	conflictedMerge(cwd);
	const head = git(cwd, ['rev-parse', 'HEAD']);
	const hook = installHook(cwd);
	const unsigned = runGit(cwd, [...hook, 'commit', '--no-edit']);
	assert.ifError(unsigned.error);
	assert.notEqual(unsigned.status, 0);
	assert.match(unsigned.stderr, /Missing Signed-off-by/);
	const signedResult = runGit(cwd, [...hook, 'commit', '--no-edit', '-s']);
	assert.ifError(signedResult.error);
	assert.notEqual(signedResult.status, 0);
	assert.match(signedResult.stderr, /Leftover # line/);
	assert.doesNotMatch(signedResult.stderr, /Missing Signed-off-by/);
	assert.equal(git(cwd, ['rev-parse', 'HEAD']), head);
});
