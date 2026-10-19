#!/usr/bin/env node
// Runs `node --test` on the files a glob matches and fails when it matches none.
//
// `node --test <glob>` exits 0 when the glob matches nothing, so a deleted suite
// would leave the task green. The earlier `ls <glob> > /dev/null` guard did the
// matching in the shell, and pnpm runs scripts through cmd.exe on Windows, where
// `/dev/null` does not exist (HISS-21). Matching here keeps one form on every OS.
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The sorted files that the globs match, relative to `cwd`.
 *
 * @param {string[]} patterns
 * @param {string} cwd
 * @returns {string[]}
 */
export function matchTests(patterns, cwd) {
	return [...new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd })))].sort();
}

/**
 * Runs the test files the globs match and returns the exit status.
 *
 * @param {string[]} patterns
 * @param {string} cwd
 * @returns {number}
 */
export function runTests(patterns, cwd) {
	if (patterns.length === 0) {
		console.error('node-test: no glob given');
		return 2;
	}
	const files = matchTests(patterns, cwd);
	if (files.length === 0) {
		console.error(`node-test: no test file matches ${patterns.join(' ')}`);
		return 1;
	}
	// An inherited NODE_TEST_CONTEXT turns the child into a reporter for a parent run, which exits 0.
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(process.execPath, ['--test', ...files], { cwd, env, stdio: 'inherit' });
	if (result.error) {
		console.error(`node-test: ${result.error.message}`);
		return 1;
	}
	return result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = runTests(process.argv.slice(2), process.cwd());
}
