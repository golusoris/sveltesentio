import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { escapeBareEmphasis, loadMarkdownlint, MAX_TOKENS } from './release-changelog-escape.mjs';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const escapeScript = join(repoRoot, 'scripts', 'release-changelog-escape.mjs');

/** @param {string} text */
function md037RuleNames(text, md) {
	const results = md.lint({
		strings: { doc: text },
		config: { default: false, MD037: true },
	});
	return (results.doc ?? []).map((r) => r.ruleNames[0]);
}

describe('escapeBareEmphasis', () => {
	it('escapes bare markers next to whitespace', () => {
		const md = loadMarkdownlint();
		const input = '_WS. ... requires _WS,';
		const out = escapeBareEmphasis(input, md);
		assert.ok(out.includes('\\_WS'));
		assert.deepEqual(md037RuleNames(out, md), []);
	});

	it('escapes @sveltesentio/* package style bare asterisk', () => {
		const md = loadMarkdownlint();
		const out = escapeBareEmphasis('@sveltesentio/* package', md);
		assert.equal(out, '@sveltesentio/\\* package');
		assert.deepEqual(md037RuleNames(out, md), []);
	});

	it('leaves intraword underscores and resolved emphasis unchanged', () => {
		const md = loadMarkdownlint();
		const fixtures = [
			'id_token',
			'COLLAB_AUTH_NOT_BOUND_TYPE',
			'(_WS)',
			'`_WS`',
			'_word_',
			'**bold**',
		];
		for (const text of fixtures) {
			assert.equal(escapeBareEmphasis(text, md), text);
		}
	});

	it('is idempotent on already escaped markers', () => {
		const md = loadMarkdownlint();
		const once = escapeBareEmphasis('requires \\_WS next', md);
		const twice = escapeBareEmphasis(once, md);
		assert.equal(twice, once);
	});

	it('skips fenced code and HTML flow blocks', () => {
		const md = loadMarkdownlint();
		const code = '```\n_WS x _WS\n```';
		const html = '<div>\n_a _\n</div>';
		assert.equal(escapeBareEmphasis(code, md), code);
		assert.equal(escapeBareEmphasis(html, md), html);
	});

	it('escapes each character in multi-character markers beside whitespace', () => {
		const md = loadMarkdownlint();
		const out = escapeBareEmphasis('__init__ x __', md);
		assert.equal(out, '__init__ x \\_\\_');
		assert.deepEqual(md037RuleNames(out, md), []);
	});

	it('leaves link labels and URLs alone and escapes the marker after the link', () => {
		const md = loadMarkdownlint();
		// micromark keeps a link label as one data token, so MD037 never sees
		// markers inside it; only the bare marker after the link needs a backslash.
		const input = '[x _WS](https://example.test/a_b) x _WS';
		const out = escapeBareEmphasis(input, md);
		assert.equal(out, '[x _WS](https://example.test/a_b) x \\_WS');
		assert.deepEqual(md037RuleNames(out, md), []);
	});

	it('boundary: token walk bound names MAX_TOKENS', () => {
		const md = loadMarkdownlint();
		const text = '# Title\n\n* item _WS\n';
		assert.throws(() => escapeBareEmphasis(text, md, { maxTokens: 3 }), /MAX_TOKENS=3/u);
	});
});

describe('release-changelog-escape CLI', () => {
	it('escapes a temp file and prints its path', () => {
		const md = loadMarkdownlint();
		const tmpDir = mkdtempSync(join(tmpdir(), 'changelog-escape-cli-'));
		const file = join(tmpDir, 'CHANGELOG.md');
		const fixture = 'to _WS end';
		writeFileSync(file, fixture, 'utf8');
		try {
			const stdout = execFileSync(process.execPath, [escapeScript, file], {
				encoding: 'utf8',
				timeout: 60000,
			});
			assert.match(stdout, new RegExp(`escaped ${file.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`));
			const body = readFileSync(file, 'utf8');
			assert.ok(body.includes('\\_WS'));
			assert.deepEqual(md037RuleNames(body, md), []);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('exits 2 without file arguments', () => {
		assert.throws(
			() => execFileSync(process.execPath, [escapeScript], { timeout: 60000 }),
			(err) => err.status === 2,
		);
	});

	it('exits 2 when more than MAX_FILES arguments are passed', () => {
		const args = Array.from({ length: 257 }, (_, i) => `f${i}.md`);
		assert.throws(
			() =>
				execFileSync(process.execPath, [escapeScript, ...args], {
					timeout: 60000,
					stdio: 'pipe',
				}),
			(err) => err.status === 2,
		);
	});
});

describe('constants', () => {
	it('exports MAX_TOKENS', () => {
		assert.equal(MAX_TOKENS, 1_000_000);
	});
});

// The release format job escapes every change log it touches, so each committed
// change log must already be a fixed point; a hand edit that adds a bare marker
// next to whitespace fails here before markdownlint MD037 sees a pair.
describe('committed change logs', () => {
	const config = JSON.parse(readFileSync(join(repoRoot, 'release-please-config.json'), 'utf8'));
	const logs = [
		'CHANGELOG.md',
		...Object.keys(config.packages).map((dir) => `${dir}/CHANGELOG.md`),
	].filter((path) => existsSync(join(repoRoot, path)));

	it('boundary: finds the root and every release package change log', () => {
		assert.ok(logs.includes('CHANGELOG.md'));
		assert.ok(logs.length > 1);
	});

	it('are unchanged by the escape', () => {
		const md = loadMarkdownlint();
		const drifted = logs.filter((path) => {
			const text = readFileSync(join(repoRoot, path), 'utf8');
			return escapeBareEmphasis(text, md) !== text;
		});
		assert.deepEqual(drifted, []);
	});
});
