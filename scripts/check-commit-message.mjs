#!/usr/bin/env node
// Refuse missing/mismatched sign-offs, malformed sign-offs and surviving # lines; merges too.
// Lesson: a conflicted merge committed with --no-edit retained # Conflicts: without a sign-off.
// Git v2.51.0 builtin/commit.c:run_commit_hook sets GIT_EDITOR=: without an editor;
// git merge uses the same call. commit-msg runs before cleanup (:1128 vs :1892).
// sequencer.c:get_cleanup_mode: unset/default strips comments only with an editor;
// strip always strips; whitespace/verbatim/scissors preserve comments. Scissors truncates
// at CUT_LINE with an editor. The hook cannot see --cleanup= overrides: dispatcher
// read-back supplies the second barrier. git commit -s uses git var GIT_COMMITTER_IDENT
// (GIT_COMMITTER_EMAIL, else user.email; both agree in this repository).
// Hook shape and file reader adopted from plurano/horistes (lefthook.yml commit-msg job,
// tests/test_commit_messages.py, commit 5af6eeda, EUPL-1.2), horistes ADR-0072.
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

/** @type {number} */
export const MESSAGE_BYTES = 262144;
/** @type {number} */
export const GIT_TIMEOUT_MS = 10_000;
/** @type {string} */
export const CUT_LINE = '# ------------------------ >8 ------------------------';

/**
 * @param {string} path
 * @returns {string}
 */
export function readMessageFile(path) {
	const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
	try {
		if (!fstatSync(fd).isFile()) throw new Error('Message file must be a regular file');
		const buffer = Buffer.alloc(MESSAGE_BYTES + 1);
		let size = 0;
		// Each successful read consumes at least one byte; EOF stops immediately.
		for (let attempt = 0; attempt < buffer.length; attempt++) {
			const count = readSync(fd, buffer, size, buffer.length - size, null);
			if (count === 0) break;
			size += count;
			if (size > MESSAGE_BYTES) throw new Error(`Message exceeds ${MESSAGE_BYTES} bytes`);
		}
		return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
	} finally {
		closeSync(fd);
	}
}

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [input]
 * @param {boolean} [allowMissing]
 * @returns {string | undefined}
 */
function gitOutput(args, cwd, env, input, allowMissing = false) {
	const result = spawnSync('git', args, {
		cwd,
		env,
		input,
		encoding: 'utf8',
		timeout: GIT_TIMEOUT_MS,
		maxBuffer: MESSAGE_BYTES + 1,
	});
	if (!result.error && result.status === 0) return result.stdout;
	if (!result.error && allowMissing && result.status === 1) return undefined;
	throw new Error(`Cannot judge: git ${args.join(' ')} failed`);
}

/**
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function committerEmail(cwd, env) {
	const ident = gitOutput(['var', 'GIT_COMMITTER_IDENT'], cwd, env);
	const email = /<([^<>\s@]+@[^<>\s@]+)>/.exec(ident ?? '')?.[1];
	if (!email) throw new Error('Cannot judge: committer email missing');
	return email;
}

/**
 * A null entry preserves a malformed sign-off as a finding for the pure judge.
 * @param {string} message
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {(string | null)[]}
 */
export function signOffEmails(message, cwd, env) {
	const trailers = gitOutput(['interpret-trailers', '--parse'], cwd, env, message);
	return (trailers ?? '')
		.split('\n')
		.filter((line) => /^signed-off-by:/i.test(line))
		.map((line) => {
			const value = line.slice(line.indexOf(':') + 1).trim();
			const match = /^([^\s<>][^<>]*)<([^<>\s@]+@[^<>\s@]+)>$/.exec(value);
			return match && /\s$/.test(match[1]) ? match[2] : null;
		});
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string | undefined} cleanup
 * @returns {boolean}
 */
export function commentsSurvive(env, cleanup) {
	if (cleanup === undefined || cleanup === 'default') return env.GIT_EDITOR === ':';
	if (cleanup === 'strip') return false;
	if (['whitespace', 'verbatim', 'scissors'].includes(cleanup)) return true;
	throw new Error(`Cannot judge: unknown commit.cleanup ${JSON.stringify(cleanup)}`);
}

/**
 * @param {string} message
 * @returns {string[]}
 */
function commentFindings(message) {
	const lines = message.split(/\r?\n/);
	const numbers = [];
	for (let index = 0; index < lines.length; index++) {
		if (lines[index] === CUT_LINE) break;
		if (lines[index].startsWith('#')) numbers.push(index + 1);
	}
	const findings = numbers.slice(0, 5).map((line) => `Leftover # line at line ${line}`);
	if (numbers.length > 5) findings.push(`and ${numbers.length - 5} more # lines`);
	return findings;
}

/**
 * @param {string} message
 * @param {{ email: string, signOffs: (string | null)[], commentsSurvive: boolean }} options
 * @returns {string[]}
 */
export function judgeMessage(message, { email, signOffs, commentsSurvive: keepComments }) {
	const findings = [];
	if (signOffs.length === 0) findings.push('Missing Signed-off-by trailer');
	if (signOffs.includes(null)) {
		findings.push('Malformed Signed-off-by: expected Name <local@domain>');
	}
	const matches = signOffs.some((value) => value?.toLowerCase() === email.toLowerCase());
	if (signOffs.length > 0 && !matches) {
		findings.push(`Signed-off-by must name the committer email <${email}>`);
	}
	if (keepComments) findings.push(...commentFindings(message));
	return findings;
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {number}
 */
export function main(argv, { cwd, env }) {
	try {
		if (argv.length !== 1) throw new Error('Usage: check-commit-message.mjs <message-file>');
		const message = readMessageFile(argv[0]);
		const cleanup = gitOutput(['config', '--get', 'commit.cleanup'], cwd, env, undefined, true);
		const findings = judgeMessage(message, {
			email: committerEmail(cwd, env),
			signOffs: signOffEmails(message, cwd, env),
			commentsSurvive: commentsSurvive(env, cleanup?.trim()),
		});
		for (let index = 0; index < findings.length; index++) console.error(findings[index]);
		if (findings.length === 0) return 0;
		console.error('Fix: git commit -s; remove the # lines or let the editor strip them.');
		return 1;
	} catch (error) {
		console.error(`Cannot judge commit message: ${error.message}`);
		return 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = main(process.argv.slice(2), { cwd: process.cwd(), env: process.env });
}
