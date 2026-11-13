#!/usr/bin/env node
// Pre-push second barrier for check-commit-message.mjs: judge stored messages of every commit
// the push adds beyond known remote oids. Exclude destination tracking refs only for an
// unambiguous remote with one push URL equal to its fetch URL and no other remote's fetch
// refspec writing its tracking namespace; otherwise judge everything sent beyond known oids.
// Stored objects are immutable: --cleanup= overrides, editors and message-file rewrites
// cannot slip # lines or missing sign-offs past this check; every stored # line is a finding.
import { Buffer } from 'node:buffer';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { gitOutput, judgeMessage, signOffEmails } from './check-commit-message.mjs';

/** @type {number} */
export const PUSH_INPUT_BYTES = 1_048_576;
/** @type {number} */
export const MAX_COMMITS = 1000;
/** @type {number} */
export const STDIN_TIMEOUT_MS = 10_000;
/** @type {RegExp} */
export const PUSH_LINE_RE = /^(\S+) ([0-9a-f]{40}|[0-9a-f]{64}) (\S+) ([0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * @param {import('node:stream').Readable} stream
 * @param {{ bytes?: number, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export function readInput(stream, { bytes = PUSH_INPUT_BYTES, timeoutMs = STDIN_TIMEOUT_MS } = {}) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		let settled = false;
		const timer = setTimeout(() => {
			finish(new Error(`Push input not closed within ${timeoutMs} ms`), undefined, true);
		}, timeoutMs);
		/** @param {Error} [error] @param {string} [value] @param {boolean} [destroy] */
		function finish(error, value, destroy = false) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(value);
			if (destroy) stream.destroy();
		}
		stream.on('data', (chunk) => {
			if (settled) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			total += buffer.length;
			if (total > bytes) {
				finish(new Error(`Push input exceeds ${bytes} bytes`), undefined, true);
			} else chunks.push(buffer);
		});
		stream.once('error', (error) => finish(error));
		stream.once('end', () => {
			try {
				finish(undefined, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
			} catch (error) {
				finish(error);
			}
		});
	});
}

/**
 * @param {string} text
 * @returns {{ local: string, remote: string }[]}
 */
export function parsePushLines(text) {
	const lines = text.split('\n');
	if (lines.at(-1) === '') lines.pop();
	const updates = [];
	for (let index = 0; index < lines.length; index++) {
		const match = PUSH_LINE_RE.exec(lines[index]);
		if (!match) throw new Error(`Malformed pre-push line ${index + 1}`);
		if (/^0+$/.test(match[2])) continue;
		updates.push({ local: match[2], remote: /^0+$/.test(match[4]) ? '' : match[4] });
	}
	return updates;
}

/**
 * Only unambiguous remote names with one push URL equal to their fetch URL can bound history.
 * No other remote's fetch refspec may write the destination's tracking namespace.
 * Otherwise judge everything sent beyond known remote oids.
 * --remotes=<name> implies <name>/*, so nested configured names cannot safely bound it.
 * @param {string} remote
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function destinationExclusion(remote, cwd, env) {
	if (!remote) return [];
	const names = (gitOutput(['remote'], cwd, env) ?? '').split('\n');
	if (!names.includes(remote)) return [];
	const ambiguous = names.some(
		(other) => other.startsWith(`${remote}/`) || remote.startsWith(`${other}/`),
	);
	if (ambiguous) return [];
	if (!pushMatchesFetch(remote, cwd, env) || foreignTrackingWriter(remote, cwd, env)) return [];
	return ['--not', `--remotes=${remote}`];
}

/**
 * @param {string} remote
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function pushMatchesFetch(remote, cwd, env) {
	const fetch = (gitOutput(['remote', 'get-url', remote], cwd, env) ?? '').trim();
	const push = (gitOutput(['remote', 'get-url', '--push', '--all', remote], cwd, env) ?? '')
		.split('\n')
		.filter((line) => line.length > 0);
	return push.length === 1 && push[0] === fetch;
}

/**
 * Only the part after a refspec's first ':' writes refs; a spec without ':' (negative ones
 * included, as git refuses '^src:dst') writes no tracking ref. Unparsed lines count as writers.
 * @param {string} remote
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function foreignTrackingWriter(remote, cwd, env) {
	const args = ['config', '--get-regexp', '^remote\\..*\\.fetch$'];
	const fetches = gitOutput(args, cwd, env, undefined, true) ?? '';
	const namespace = `refs/remotes/${remote}/`;
	return fetches.split('\n').some((line) => {
		const match = /^remote\.(.+)\.fetch (.*)$/.exec(line);
		if (!match) return line.length > 0;
		if (match[1] === remote) return false;
		const spec = match[2];
		const colon = spec.indexOf(':');
		if (colon < 0) return false;
		const prefix = spec.slice(colon + 1).split('*')[0];
		return prefix.startsWith(namespace) || namespace.startsWith(prefix);
	});
}

/**
 * @param {{ local: string, remote: string }[]} updates
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} [exclusion]
 * @returns {string[]}
 */
export function pushedCommits(updates, cwd, env, exclusion = []) {
	if (updates.length === 0) return [];
	const excludedOids = [];
	for (let index = 0; index < updates.length; index++) {
		const oid = updates[index].remote;
		if (!oid) continue;
		const known = gitOutput(
			['rev-parse', '--verify', '--quiet', `${oid}^{commit}`],
			cwd,
			env,
			undefined,
			true,
		);
		if (known !== undefined) excludedOids.push(`^${oid}`);
	}
	const locals = updates.map((update) => update.local);
	const output = gitOutput(
		['rev-list', `--max-count=${MAX_COMMITS + 1}`, ...locals, ...excludedOids, ...exclusion],
		cwd,
		env,
	);
	const shas = (output ?? '').split('\n').filter((line) => line.length > 0);
	if (shas.length > MAX_COMMITS) {
		throw new Error(`More than ${MAX_COMMITS} commits to judge; fetch the remote first`);
	}
	return shas;
}

/**
 * @param {string} sha
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ email: string, message: string }}
 */
export function storedMessage(sha, cwd, env) {
	const output =
		gitOutput(
			['log', '-1', '--no-show-signature', '--no-color', '--format=%ce%x00%B', sha],
			cwd,
			env,
		) ?? '';
	const separator = output.indexOf('\0');
	if (separator < 1) throw new Error(`Cannot judge: commit ${sha} has no committer email`);
	return { email: output.slice(0, separator), message: output.slice(separator + 1) };
}

/**
 * @param {string[]} shas
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function judgeCommits(shas, cwd, env) {
	const findings = [];
	for (let index = 0; index < shas.length; index++) {
		const sha = shas[index];
		const { email, message } = storedMessage(sha, cwd, env);
		const judged = judgeMessage(message, {
			email,
			signOffs: signOffEmails(message, cwd, env),
			commentsSurvive: true,
		});
		findings.push(...judged.map((finding) => `${sha.slice(0, 12)}: ${finding}`));
	}
	return findings;
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, stdin: import('node:stream').Readable }} options
 * @returns {Promise<number>}
 */
export async function main(argv, { cwd, env, stdin }) {
	try {
		if (argv.length > 2) {
			throw new Error('Usage: check-pushed-commits.mjs [remote-name remote-url]');
		}
		const updates = parsePushLines(await readInput(stdin));
		const remote = argv[0] ?? '';
		const exclusion = destinationExclusion(remote, cwd, env);
		const findings = judgeCommits(pushedCommits(updates, cwd, env, exclusion), cwd, env);
		for (let index = 0; index < findings.length; index++) console.error(findings[index]);
		if (findings.length === 0) return 0;
		if (exclusion.length === 0) {
			console.error(
				'No remote-tracking refs of a configured destination bounded this check; ' +
					'every commit the push sends was judged.',
			);
		}
		console.error(
			"Fix: git rebase -i --exec 'git commit --amend --no-edit -s' <base>, " +
				'or reword the commits; remove the # lines.',
		);
		return 1;
	} catch (error) {
		console.error(`Cannot judge pushed commits: ${error.message}`);
		return 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main(process.argv.slice(2), {
		cwd: process.cwd(),
		env: process.env,
		stdin: process.stdin,
	});
}
