#!/usr/bin/env node
// Fails if an issue form under .github/ISSUE_TEMPLATE names a label the
// repository does not have.
//
// GitHub applies the `labels` of an issue form only when each label exists; a
// missing one is dropped without a message, so a triage label that was never
// created leaves every new issue untriaged and nobody notices.
//
// GitHub issue forms accept labels as an array (inline or block list) or as a
// comma-delimited string. Duplicate keys and malformed docs are refused.
// The repository labels come from the GitHub REST API (GITHUB_REPOSITORY and
// GITHUB_TOKEN, as in a workflow run) or from a JSON file of label names given
// with --labels-file. With neither, the check fails: it never passes unread.
//
// The `Template labels` job in ci.yml runs it; `pnpm test:scripts` runs the
// tests in check-template-labels.test.mjs.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const templatesDir = join(root, '.github', 'ISSUE_TEMPLATE');

// Upper bounds (HISS-02): directory entries one scan reads, label pages one
// API read fetches (100 labels each), labels per form, labels per file,
// revalidation count, and I/O deadlines.
const ENTRY_LIMIT = 1_000;
export const PAGE_LIMIT = 20;
export const PAGE_SIZE = 100;
export const LABEL_LIMIT = 100;
export const LABELS_FILE_LIMIT = 2_000;
export const REVALIDATE_LIMIT = 100;
export const IO_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** GitHub reads issue forms with either extension; config.yml is not a form. */
const FORM_FILE = /\.ya?ml$/;
const NOT_A_FORM = new Set(['config.yml', 'config.yaml']);

/** Races a promise against a timer, clearing the timer so no timer or floating promise leaks. */
export async function withTimeout(
	promise,
	timeoutMs = IO_TIMEOUT_MS,
	description = 'fs operation',
) {
	let timer;
	const noop = () => {};
	if (typeof promise?.catch === 'function') {
		promise.catch(noop);
	}
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`${description} timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function parseLabelString(value, where) {
	const items = value
		.split(',')
		.map((label) => label.trim())
		.filter((label) => label.length > 0);
	if (items.length === 0) {
		throw new Error(`${where}: labels must be an array or comma-delimited string`);
	}
	if (items.length > LABEL_LIMIT) {
		throw new Error(`${where}: exceeds limit of ${LABEL_LIMIT} labels, got ${items.length}`);
	}
	return items;
}

function parseLabelArray(items, where) {
	if (items.length > LABEL_LIMIT) {
		throw new Error(`${where}: exceeds limit of ${LABEL_LIMIT} labels, got ${items.length}`);
	}
	for (const item of items) {
		if (typeof item !== 'string') {
			throw new Error(`${where}: label item must be a string, got ${typeof item}`);
		}
	}
	return items;
}

/** The labels one issue form names; throws on an invalid form, doc, or label item. */
export function templateLabels(source, where = 'template') {
	let doc;
	try {
		doc = parse(source, { uniqueKeys: true });
	} catch (error) {
		throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
		throw new Error(`${where}: template must be a YAML mapping`);
	}
	if (!('labels' in doc)) {
		return [];
	}
	if (typeof doc.labels === 'string') {
		return parseLabelString(doc.labels, where);
	}
	if (Array.isArray(doc.labels)) {
		return parseLabelArray(doc.labels, where);
	}
	throw new Error(
		`${where}: labels must be an array or comma-delimited string, got ${doc.labels === null ? 'null' : typeof doc.labels}`,
	);
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
	const entries = await withTimeout(
		readdir(dir, { withFileTypes: true }),
		IO_TIMEOUT_MS,
		`readdir ${dir}`,
	);
	if (entries.length > ENTRY_LIMIT) {
		throw new Error(`${dir} holds more than ${ENTRY_LIMIT} entries`);
	}
	const files = entries
		.filter((e) => e.isFile() && FORM_FILE.test(e.name) && !NOT_A_FORM.has(e.name))
		.map((e) => e.name)
		.sort();
	const templates = [];
	for (const file of files) {
		const source = await readFile(join(dir, file), {
			encoding: 'utf8',
			signal: AbortSignal.timeout(IO_TIMEOUT_MS),
		});
		templates.push({ file, labels: templateLabels(source, file) });
	}
	return templates;
}

/** Every label name of `repository` (owner/name), read page by page from the REST API. */
export async function fetchRepoLabels(repository, token, fetchImpl = fetch) {
	const names = [];
	for (let page = 1; page <= PAGE_LIMIT + 1; page++) {
		const url = `https://api.github.com/repos/${repository}/labels?per_page=${PAGE_SIZE}&page=${page}`;
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

		if (page === PAGE_LIMIT + 1) {
			if (batch.length === 0) return names;
			throw new Error(`${repository} has more than ${PAGE_LIMIT * PAGE_SIZE} labels`);
		}

		for (let i = 0; i < batch.length; i++) {
			const item = batch[i];
			if (!item || typeof item.name !== 'string') {
				throw new Error(
					`GET ${url}: label at index ${i} has invalid name, got ${typeof item?.name}`,
				);
			}
			names.push(item.name);
		}
		if (batch.length < PAGE_SIZE) return names;
	}
	return names;
}

/** Checks whether a single label exists in `repository` via the REST API. */
export async function checkLabelExists(repository, token, name, fetchImpl = fetch) {
	const url = `https://api.github.com/repos/${repository}/labels/${encodeURIComponent(name)}`;
	const response = await fetchImpl(url, {
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'x-github-api-version': '2022-11-28',
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (response.status === 200) return true;
	if (response.status === 404) return false;
	throw new Error(`GET ${url}: HTTP ${response.status}`);
}

/** Revalidates candidate missing labels against individual label endpoints to handle pagination shifts. */
export async function revalidateMissing(repository, token, missing, fetchImpl = fetch) {
	if (missing.length > REVALIDATE_LIMIT) {
		throw new Error(
			`too many missing labels to revalidate: ${missing.length} exceeds limit of ${REVALIDATE_LIMIT}`,
		);
	}
	const checked = new Map();
	const stillMissing = [];
	for (const item of missing) {
		const key = item.label.toLowerCase();
		let exists = checked.get(key);
		if (exists === undefined) {
			exists = await checkLabelExists(repository, token, item.label, fetchImpl);
			checked.set(key, exists);
		}
		if (!exists) {
			stillMissing.push(item);
		}
	}
	return stillMissing;
}

async function readLabelsFile(file) {
	const content = await readFile(file, {
		encoding: 'utf8',
		signal: AbortSignal.timeout(IO_TIMEOUT_MS),
	});
	const names = JSON.parse(content);
	if (!Array.isArray(names)) throw new Error(`${file}: expected a JSON list of label names`);
	if (names.length > LABELS_FILE_LIMIT) {
		throw new Error(`${file}: exceeds limit of ${LABELS_FILE_LIMIT} labels, got ${names.length}`);
	}
	for (let i = 0; i < names.length; i++) {
		if (typeof names[i] !== 'string') {
			throw new Error(`${file}: item at index ${i} must be a string, got ${typeof names[i]}`);
		}
	}
	return names;
}

async function repoLabels(argv, env, fetchImpl = fetch) {
	const flag = argv.indexOf('--labels-file');
	if (flag !== -1) {
		const file = argv[flag + 1];
		if (!file) throw new Error('--labels-file needs a path');
		return readLabelsFile(file);
	}
	if (env.GITHUB_REPOSITORY && env.GITHUB_TOKEN) {
		return fetchRepoLabels(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN, fetchImpl);
	}
	throw new Error('no label source: set GITHUB_REPOSITORY and GITHUB_TOKEN, or pass --labels-file');
}

/** Returns the exit code: 0 when every label an issue form names exists. */
export async function main({
	argv = process.argv.slice(2),
	env = process.env,
	dir = templatesDir,
	fetchImpl = fetch,
} = {}) {
	const where = relative(root, dir) || dir;
	const templates = await readTemplates(dir);
	if (templates.length === 0) {
		console.error(`No issue form found in ${where}; nothing was checked.`);
		return 1;
	}
	const labels = await repoLabels(argv, env, fetchImpl);
	let missing = missingLabels(templates, labels);
	const isApiSource =
		argv.indexOf('--labels-file') === -1 && Boolean(env.GITHUB_REPOSITORY && env.GITHUB_TOKEN);
	if (missing.length > 0 && isApiSource) {
		missing = await revalidateMissing(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN, missing, fetchImpl);
	}
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
