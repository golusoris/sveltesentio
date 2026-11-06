#!/usr/bin/env node
// Fails if an issue form under .github/ISSUE_TEMPLATE names a label the
// repository does not have.
//
// GitHub applies the `labels` of an issue form only when each label exists; a
// missing one is dropped without a message, so a triage label that was never
// created leaves every new issue untriaged and nobody notices.
//
// The reading accepts two forms of the `labels` key and nothing else, so a form
// this script does not know fails instead of reading as "no labels":
//   labels: ['bug', "triage", enhancement]
//   labels:
//     - bug
// The repository labels come from the GitHub REST API (GITHUB_REPOSITORY and
// GITHUB_TOKEN, as in a workflow run) or from a JSON file of label names given
// with --labels-file. With neither, the check fails: it never passes unread.
//
// The `Template labels` job in ci.yml runs it; `pnpm test:scripts` runs the
// tests in check-template-labels.test.mjs.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const templatesDir = join(root, '.github', 'ISSUE_TEMPLATE');

// Upper bounds (HISS-02): directory entries one scan reads, label pages one
// API read fetches (100 labels each), and the deadline of one request.
const ENTRY_LIMIT = 1_000;
const PAGE_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 15_000;

/** GitHub reads issue forms with either extension; config.yml is not a form. */
const FORM_FILE = /\.ya?ml$/;
const NOT_A_FORM = new Set(['config.yml', 'config.yaml']);

const BARE = /^[^\s'",[\]#][^'",[\]#]*$/;

/** One list item: quoted with ' or ", or a bare word. */
function unquote(raw, where) {
	const item = raw.trim();
	const quoted = /^'([^']*)'$/.exec(item) ?? /^"([^"]*)"$/.exec(item);
	if (quoted) return quoted[1];
	if (BARE.test(item)) return item.trim();
	throw new Error(`${where}: cannot read label item ${JSON.stringify(item)}`);
}

/** The labels one issue form names; throws on a `labels` form it does not know. */
export function templateLabels(source, where = 'template') {
	const lines = source.split(/\r?\n/);
	const at = lines.findIndex((line) => /^labels\s*:/.test(line));
	if (at === -1) return [];
	const rest = lines[at].replace(/^labels\s*:/, '').trim();
	if (rest.startsWith('[')) {
		const inline = /^\[(.*)\]\s*(#.*)?$/.exec(rest);
		if (!inline) throw new Error(`${where}:${at + 1}: unclosed labels list`);
		const body = inline[1].trim();
		return body === '' ? [] : body.split(',').map((item) => unquote(item, `${where}:${at + 1}`));
	}
	if (rest !== '' && !rest.startsWith('#')) {
		throw new Error(`${where}:${at + 1}: labels is neither a list nor a block list`);
	}
	const labels = [];
	for (let index = at + 1; index < lines.length; index++) {
		const line = lines[index];
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (!item) break;
		labels.push(unquote(item[1], `${where}:${index + 1}`));
	}
	return labels;
}

/** Labels named by a template that are not in `repoLabels`, compared as GitHub does, ignoring case. */
export function missingLabels(templates, repoLabels) {
	const have = new Set(repoLabels.map((name) => name.toLowerCase()));
	const missing = [];
	for (const { file, labels } of templates) {
		for (const label of labels) {
			if (!have.has(label.toLowerCase())) missing.push({ file, label });
		}
	}
	return missing;
}

/** Reads every issue form in `dir`. */
export async function readTemplates(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	if (entries.length > ENTRY_LIMIT)
		throw new Error(`${dir} holds more than ${ENTRY_LIMIT} entries`);
	const files = entries
		.filter((e) => e.isFile() && FORM_FILE.test(e.name) && !NOT_A_FORM.has(e.name))
		.map((e) => e.name)
		.sort();
	const templates = [];
	for (const file of files) {
		const source = await readFile(join(dir, file), 'utf8');
		templates.push({ file, labels: templateLabels(source, file) });
	}
	return templates;
}

/** Every label name of `repository` (owner/name), read page by page from the REST API. */
export async function fetchRepoLabels(repository, token, fetchImpl = fetch) {
	const names = [];
	for (let page = 1; page <= PAGE_LIMIT; page++) {
		const url = `https://api.github.com/repos/${repository}/labels?per_page=100&page=${page}`;
		const response = await fetchImpl(url, {
			headers: {
				accept: 'application/vnd.github+json',
				authorization: `Bearer ${token}`,
				'x-github-api-version': '2022-11-28',
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
		const batch = await response.json();
		if (!Array.isArray(batch)) throw new Error(`GET ${url}: response is not a list`);
		names.push(...batch.map((label) => String(label.name)));
		if (batch.length < 100) return names;
	}
	throw new Error(`${repository} has more than ${PAGE_LIMIT * 100} labels`);
}

async function repoLabels(argv, env) {
	const flag = argv.indexOf('--labels-file');
	if (flag !== -1) {
		const file = argv[flag + 1];
		if (!file) throw new Error('--labels-file needs a path');
		const names = JSON.parse(await readFile(file, 'utf8'));
		if (!Array.isArray(names)) throw new Error(`${file}: expected a JSON list of label names`);
		return names.map(String);
	}
	if (env.GITHUB_REPOSITORY && env.GITHUB_TOKEN) {
		return fetchRepoLabels(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN);
	}
	throw new Error('no label source: set GITHUB_REPOSITORY and GITHUB_TOKEN, or pass --labels-file');
}

/** Returns the exit code: 0 when every label an issue form names exists. */
export async function main({
	argv = process.argv.slice(2),
	env = process.env,
	dir = templatesDir,
} = {}) {
	const where = relative(root, dir) || dir;
	const templates = await readTemplates(dir);
	if (templates.length === 0) {
		console.error(`No issue form found in ${where}; nothing was checked.`);
		return 1;
	}
	const missing = missingLabels(templates, await repoLabels(argv, env));
	if (missing.length > 0) {
		console.error(`Issue forms in ${where} name labels the repository does not have:\n`);
		for (const { file, label } of missing) console.error(`  ${file}: ${label}`);
		console.error('\nCreate the label, or drop it from the form.');
		return 1;
	}
	const count = templates.reduce((sum, t) => sum + t.labels.length, 0);
	console.log(
		`OK: ${count} labels named by ${templates.length} issue forms in ${where} all exist.`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
