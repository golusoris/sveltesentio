#!/usr/bin/env node
// Fails if a workflow under .github/workflows names the floating Linux runner
// label.
//
// The hosted runner behind `ubuntu-latest` moves to the next system release on
// a date this repository does not choose, so a job that names it changes its
// build machine without a commit. Every job here runs on a pinned label, and
// this check keeps a new or edited workflow from bringing the floating one back.
//
// The reading is textual and deliberately wide. The label is refused wherever a
// workflow file names it outside a whole-line comment: a `runs-on` scalar, a
// label list, a matrix value, an input of a reusable workflow. That needs no
// YAML parser — a new dependency, which hard rule 2 puts behind a D-row — and it
// fails closed: a mention that selects no runner, such as a step name or a
// trailing comment, is refused too and has to be reworded.
//
// Two things stay out of reach:
//   - a label assembled at run time (`ubuntu-${{ inputs.release }}`) never
//     appears as text;
//   - the floating macOS and Windows labels are not read.
//
// `pnpm test:scripts` runs it: the last test in check-runner-labels.test.mjs
// reads this repository's workflows. Run this file directly for the list of lines.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const workflowsDir = join(root, '.github', 'workflows');

export const FLOATING_LABEL = 'ubuntu-latest';

/**
 * The label as a whole token. `ubuntu-latest-xl` and `team-ubuntu-latest` are
 * labels of their own, which an organisation may give a runner group.
 */
const FLOATING = /(?<![\w-])ubuntu-latest(?![\w-])/;

/** GitHub reads the files directly inside the directory, with either extension. */
const WORKFLOW_FILE = /\.ya?ml$/;

// Upper bound on the directory entries one scan reads (HISS-02). The directory
// holds about ten workflows; the bound stops a mis-pointed path, and running
// into it is an error, not a truncated result.
const ENTRY_LIMIT = 1_000;

/** Lines of one workflow source that name the floating label. */
export function findFloatingLabels(source) {
	const findings = [];
	for (const [index, text] of source.split(/\r?\n/).entries()) {
		if (text.trimStart().startsWith('#')) continue;
		if (FLOATING.test(text)) findings.push({ line: index + 1, text: text.trim() });
	}
	return findings;
}

/** Reads every workflow file in `dir` and returns what was read and what was found. */
export async function scanWorkflows(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	if (entries.length > ENTRY_LIMIT) {
		throw new Error(`${dir} holds more than ${ENTRY_LIMIT} entries`);
	}
	const files = entries
		.filter((entry) => entry.isFile() && WORKFLOW_FILE.test(entry.name))
		.map((entry) => entry.name)
		.sort();

	const findings = [];
	for (const file of files) {
		const source = await readFile(join(dir, file), 'utf8');
		for (const finding of findFloatingLabels(source)) findings.push({ file, ...finding });
	}
	return { files, findings };
}

/** Returns the exit code: 0 when workflows were read and none names the label. */
export async function main(dir = workflowsDir) {
	const { files, findings } = await scanWorkflows(dir);
	const where = relative(root, dir);

	if (files.length === 0) {
		console.error(`No workflow file found in ${where}; nothing was checked.`);
		return 1;
	}
	if (findings.length > 0) {
		console.error(`The floating runner label ${FLOATING_LABEL} is named in ${where}:\n`);
		for (const { file, line, text } of findings) console.error(`  ${file}:${line}: ${text}`);
		console.error('\nName a pinned label such as ubuntu-26.04, or reword the line.');
		return 1;
	}
	console.log(`OK: no workflow among ${files.length} in ${where} names ${FLOATING_LABEL}.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
