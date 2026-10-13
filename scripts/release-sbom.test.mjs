// Holds the release workflow to its SBOM promise (docs/principles.md §2.5):
// the CycloneDX SBOM is generated before any package reaches the registry,
// and a failing SBOM step stops the release. The workflow has no script of
// its own, so this test reads the step list of release-please.yml by its
// indentation, the way ci-sveltekit-coverage.test.mjs reads its step.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workflow = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
	'release-please.yml',
);

const STEP_START = '      - ';
const STEP_BODY = '        ';

/** The steps of the workflow's jobs, each as the list of its lines. */
function steps(source) {
	const found = [];
	for (const line of source.split('\n')) {
		if (line.startsWith(STEP_START)) {
			found.push([line]);
		} else if (found.length > 0 && line.startsWith(STEP_BODY)) {
			found.at(-1).push(line);
		}
	}
	return found;
}

const isSbom = (step) => step.some((line) => /\buses: anchore\/sbom-action@/.test(line));
const isPublish = (step) => step.some((line) => /\bpnpm (-r )?publish\b/.test(line));

/** Every reason the SBOM step breaks the promise; empty when it holds. */
export function sbomFindings(source) {
	const list = steps(source);
	const sbom = list.findIndex(isSbom);
	const publish = list.findIndex(isPublish);
	if (sbom < 0) return ['no anchore/sbom-action step'];
	if (publish < 0) return ['no publish step'];
	const findings = [];
	if (sbom > publish) findings.push('SBOM step runs after the publish step');
	const soft = list[sbom].find((line) => /^\s+(- )?continue-on-error:/.test(line));
	if (soft !== undefined && !/continue-on-error:\s*false\s*(#.*)?$/.test(soft)) {
		findings.push(`SBOM step tolerates its own failure (${soft.trim()})`);
	}
	return findings;
}

const step = (...lines) => lines.map((line) => `${STEP_BODY}${line}`).join('\n');
const sbomStep = (extra = '') =>
	`${STEP_START}name: Generate SBOM\n${extra}${step('uses: anchore/sbom-action@0123 # v0', 'with:', '  format: cyclonedx-json')}\n`;
const publishStep = `${STEP_START}name: Publish\n${step('run: pnpm -r publish --access public')}\n`;
const job = (...parts) => `jobs:\n  release:\n    steps:\n${parts.join('')}`;

describe('release-please.yml SBOM step', () => {
	it('holds for the workflow in this repository', () => {
		assert.deepEqual(sbomFindings(readFileSync(workflow, 'utf8')), []);
	});

	it('accepts an SBOM step before publish', () => {
		assert.deepEqual(sbomFindings(job(sbomStep(), publishStep)), []);
	});

	it('accepts an explicit continue-on-error: false', () => {
		const strict = sbomStep(`${STEP_BODY}continue-on-error: false\n`);
		assert.deepEqual(sbomFindings(job(strict, publishStep)), []);
	});

	it('refuses an SBOM step after publish', () => {
		assert.deepEqual(sbomFindings(job(publishStep, sbomStep())), [
			'SBOM step runs after the publish step',
		]);
	});

	it('refuses continue-on-error: true on the SBOM step', () => {
		const soft = sbomStep(`${STEP_BODY}continue-on-error: true\n`);
		assert.deepEqual(sbomFindings(job(soft, publishStep)), [
			'SBOM step tolerates its own failure (continue-on-error: true)',
		]);
	});

	it('refuses an expression-valued continue-on-error', () => {
		const soft = sbomStep(`${STEP_BODY}continue-on-error: \${{ github.event_name == 'push' }}\n`);
		assert.equal(sbomFindings(job(soft, publishStep)).length, 1);
	});

	it('refuses a workflow without an SBOM step or without a publish step', () => {
		assert.deepEqual(sbomFindings(job(publishStep)), ['no anchore/sbom-action step']);
		assert.deepEqual(sbomFindings(job(sbomStep())), ['no publish step']);
	});

	it('reads a step that starts with its uses line', () => {
		const bare = `${STEP_START}uses: anchore/sbom-action@0123 # v0\n`;
		assert.deepEqual(sbomFindings(job(publishStep, bare)), [
			'SBOM step runs after the publish step',
		]);
	});
});
