#!/usr/bin/env node
// Builds and type-checks the #lib import forms of docs/compose on one
// SvelteKit major: `node tools/compose-lib-fixture/run.mjs kit2` or `kit3`.
//
// Both majors share the app in src/; each kit directory holds only what
// differs between them (package.json and lockfile, adapter configuration,
// tsconfig). The run copies src/ into the kit directory, installs the
// lockfile, builds, checks that the prerendered page holds the text every
// import form contributes, and runs svelte-check with warnings as errors.
//
// The copy is replaced on every run, so an edit belongs in src/, never in
// kit2/src or kit3/src (both are ignored by git).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export const KITS = Object.freeze(['kit2', 'kit3']);

/**
 * The text the prerendered start page holds when every import form resolved:
 * #lib/greeting.js, bare #lib, a directory index, the load function, a rune
 * module (2 * 2), a server-only module read in +page.server.ts, a component.
 */
export const EXPECTED_TEXT = Object.freeze([
	'Hello, page Hello, index button Hello, load 4 6',
	'<b>widget</b>',
]);

// Deadline on every child process (HISS-02). A cold install takes about
// 30 seconds and a build about 10 on a hosted runner.
const STEP_TIMEOUT_MS = 300_000;

/**
 * The expected texts the page lacks; empty when the page is complete. Runs of
 * whitespace count as one space, so the layout of the markup does not matter.
 */
export function missingText(html) {
	const text = html.replace(/\s+/g, ' ');
	return EXPECTED_TEXT.filter((expected) => !text.includes(expected));
}

function step(dir, command, args) {
	console.log(`\n$ (${dir}) ${command} ${args.join(' ')}`);
	execFileSync(command, args, { cwd: dir, stdio: 'inherit', timeout: STEP_TIMEOUT_MS });
}

/** Returns the exit code of one kit's run. */
export function main(kit) {
	if (!KITS.includes(kit)) {
		console.error(`usage: run.mjs <${KITS.join('|')}>`);
		return 2;
	}
	const dir = join(here, kit);
	rmSync(join(dir, 'src'), { recursive: true, force: true });
	rmSync(join(dir, 'build'), { recursive: true, force: true });
	cpSync(join(here, 'src'), join(dir, 'src'), { recursive: true });

	step(dir, 'npm', ['ci', '--no-audit', '--no-fund']);
	step(dir, 'npm', ['run', 'build']);

	const page = join(dir, 'build', 'index.html');
	if (!existsSync(page)) {
		console.error(`${kit}: the build wrote no ${page}`);
		return 1;
	}
	const missing = missingText(readFileSync(page, 'utf8'));
	if (missing.length > 0) {
		console.error(
			`${kit}: the prerendered page lacks ${missing.map((t) => JSON.stringify(t)).join(', ')}`,
		);
		return 1;
	}
	rmSync(join(dir, 'build'), { recursive: true, force: true });
	step(dir, 'npm', ['run', 'check']);
	console.log(`\nOK: ${kit} builds and type-checks every #lib import form.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = main(process.argv[2]);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
