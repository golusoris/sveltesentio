import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENTRY_LIMIT, JOB_LIMIT } from './check-job-timeouts.mjs';
import {
	CONCURRENCY_EXCEPTIONS,
	findConcurrencyViolations,
	main,
} from './check-workflow-concurrency.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const safeGroup = '${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}';
const prCancellation = "${{ github.event_name == 'pull_request' }}";
const refGroup = '${{ github.workflow }}-${{ github.ref }}';
const workflow = (block, event = 'push') =>
	`on: ${event}\n${block}\njobs:\n  build:\n    timeout-minutes: 10\n    steps: []\n`;
const concurrency = (group = safeGroup, cancel = prCancellation) =>
	`concurrency:\n  group: ${group}\n  cancel-in-progress: ${cancel}`;
const releaseWorkflow = workflow('').replace(
	'  build:',
	'  format-release-pr:\n    concurrency:\n      group: release-pr-format\n      cancel-in-progress: true',
);

describe('findConcurrencyViolations: unsafe push groups', () => {
	it('refuses ref groups with cancellation enabled or disabled', () => {
		for (const cancel of ['true', 'false']) {
			const findings = findConcurrencyViolations(workflow(concurrency(refGroup, cancel)), 'ci.yml');
			assert.equal(findings.length, 1);
			assert.equal(findings[0].file, 'ci.yml');
			assert.equal(findings[0].job, null);
			assert.match(findings[0].message, /ci.yml:.*github.run_id.*github.sha/);
		}
	});

	it('refuses string concurrency using a ref, including implicit cancel false', () => {
		assert.equal(findConcurrencyViolations(workflow(`concurrency: ${refGroup}`)).length, 1);
	});

	it('refuses non-allow-listed cancellation even with a per-run group', () => {
		for (const cancel of ['true', 'null', '"false"', '${{ inputs.cancel }}']) {
			const findings = findConcurrencyViolations(workflow(concurrency(safeGroup, cancel)));
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /cancel-in-progress/);
		}
	});

	it('refuses context names outside expressions or inside quoted literals', () => {
		for (const group of [
			'github.run_id',
			'${{ github.run_id_suffix }}',
			"${{ 'github.run_id' }}",
		]) {
			assert.equal(findConcurrencyViolations(workflow(concurrency(group))).length, 1);
		}
	});
});

describe('findConcurrencyViolations: allowed boundaries', () => {
	it('accepts per-run PR cancellation and the absent/false cancellation boundaries', () => {
		assert.deepEqual(findConcurrencyViolations(workflow(concurrency())), []);
		assert.deepEqual(findConcurrencyViolations(workflow(concurrency(safeGroup, 'false'))), []);
		assert.deepEqual(
			findConcurrencyViolations(workflow(`concurrency:\n  group: ${safeGroup}`)),
			[],
		);
	});

	it('accepts sha expressions and per-run string concurrency', () => {
		assert.deepEqual(findConcurrencyViolations(workflow(concurrency('${{ github.sha }}'))), []);
		assert.deepEqual(findConcurrencyViolations(workflow(`concurrency: ${safeGroup}`)), []);
	});

	it('accepts workflows without a concurrency block', () => {
		assert.deepEqual(findConcurrencyViolations(workflow('')), []);
	});

	it('permits ref cancellation only when every trigger is pull_request', () => {
		const block = concurrency(refGroup, 'true');
		for (const event of ['pull_request', '[pull_request]', '\n  pull_request:']) {
			assert.deepEqual(findConcurrencyViolations(workflow(block, event)), []);
		}
		for (const event of ['[pull_request, push]', '\n  pull_request:\n  schedule: []']) {
			assert.equal(findConcurrencyViolations(workflow(block, event)).length, 1);
		}
	});
});

describe('findConcurrencyViolations: job concurrency', () => {
	it('checks job blocks even when workflow concurrency is safe', () => {
		const source = workflow(concurrency()).replace(
			'  build:',
			`  build:\n    concurrency:\n      group: ${refGroup}\n      cancel-in-progress: false`,
		);
		const findings = findConcurrencyViolations(source, 'jobs.yml');
		assert.equal(findings.length, 1);
		assert.equal(findings[0].job, 'build');
		assert.match(findings[0].message, /jobs.yml: job 'build'/);
	});

	it('accepts safe job concurrency and refuses a job string ref group', () => {
		const source = workflow('').replace('  build:', `  build:\n    concurrency: ${safeGroup}`);
		assert.deepEqual(findConcurrencyViolations(source), []);
		assert.equal(findConcurrencyViolations(source.replace(safeGroup, refGroup)).length, 1);
	});
});

describe('CONCURRENCY_EXCEPTIONS', () => {
	it('contains exactly the release formatting exception and its reason', () => {
		assert.ok(CONCURRENCY_EXCEPTIONS instanceof Map);
		assert.deepEqual([...CONCURRENCY_EXCEPTIONS.keys()], ['release-please.yml#format-release-pr']);
		assert.match(
			CONCURRENCY_EXCEPTIONS.get('release-please.yml#format-release-pr'),
			/newer.*release-branch.*supersedes.*formatting/,
		);
	});

	it('permits the unsafe block only for its own file and job', () => {
		assert.deepEqual(findConcurrencyViolations(releaseWorkflow, 'release-please.yml'), []);
		assert.equal(findConcurrencyViolations(releaseWorkflow, 'other.yml').length, 1);
		const wrongJob = releaseWorkflow.replace('format-release-pr:', 'other:');
		assert.equal(findConcurrencyViolations(wrongJob, 'release-please.yml').length, 2);
	});

	it('refuses stale exceptions when the job or block is gone', () => {
		for (const source of [workflow(''), workflow('').replace('  build:', '  format-release-pr:')]) {
			const findings = findConcurrencyViolations(source, 'release-please.yml');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /stale concurrency exception/);
		}
	});

	it('refuses stale exceptions when the block is compliant or the trigger is PR-only', () => {
		const safe = releaseWorkflow.replace('release-pr-format', safeGroup).replace('true', 'false');
		assert.match(findConcurrencyViolations(safe, 'release-please.yml')[0].message, /stale/);
		assert.match(
			findConcurrencyViolations(
				releaseWorkflow.replace('on: push', 'on: pull_request'),
				'release-please.yml',
			)[0].message,
			/stale/,
		);
	});
});

describe('findConcurrencyViolations: fail-closed parsing', () => {
	it('wraps duplicate-key and YAML syntax errors with file context', () => {
		assert.throws(
			() => findConcurrencyViolations('on: push\non: pull_request\njobs: {}', 'dup.yml'),
			/dup.yml:.*Map keys must be unique/,
		);
		assert.throws(() => findConcurrencyViolations('jobs: [', 'broken.yml'), /broken.yml:/);
	});

	it('refuses malformed workflows, triggers, jobs and blocks', () => {
		for (const source of [
			'null',
			'on: push',
			'on: []\njobs: {}',
			'on: 3\njobs: {}',
			'on: [push, null]\njobs: {}',
			workflow('concurrency: null'),
			workflow('concurrency: []'),
			workflow('concurrency: {}'),
			workflow('').replace('  build:', '  build: null\n  other:'),
		]) {
			assert.ok(findConcurrencyViolations(source, 'bad.yml').length > 0);
		}
	});

	it('resolves concurrency aliases before checking the job', () => {
		const source = workflow(concurrency().replace('concurrency:', 'concurrency: &safe')).replace(
			'  build:',
			'  build:\n    concurrency: *safe',
		);
		assert.deepEqual(findConcurrencyViolations(source), []);
	});
});

describe('findConcurrencyViolations: scalar scan bounds', () => {
	it('accepts the event bound and refuses one more', () => {
		const events = Array.from({ length: ENTRY_LIMIT }, () => 'push');
		assert.deepEqual(
			findConcurrencyViolations(workflow(concurrency(), `[${events.join(',')}]`)),
			[],
		);
		events.push('push');
		assert.match(
			findConcurrencyViolations(workflow(concurrency(), `[${events.join(',')}]`))[0].message,
			/must name between 1 and 1000 events/,
		);
	});

	it('accepts the job bound and refuses one more', () => {
		const jobs = Array.from({ length: JOB_LIMIT }, (_, index) => `  job${index}: {steps: []}`).join(
			'\n',
		);
		const source = `on: push\njobs:\n${jobs}\n`;
		assert.deepEqual(findConcurrencyViolations(source), []);
		assert.throws(
			() => findConcurrencyViolations(`${source}  overflow: {}\n`, 'large.yml'),
			/large.yml: exceeds limit of 100 jobs/,
		);
	});
});

describe('HISS-18 concurrency coverage fixtures', () => {
	const fixtures = join(root, '.config/hiss/testdata/HISS-18/internal');
	it('refuses the planted ref-group cancellation fixture', async () => {
		const file = 'push-group-cancels-tip.yml';
		const source = await readFile(join(fixtures, 'positive', file), 'utf8');
		assert.equal(findConcurrencyViolations(source, file).length, 1);
	});

	it('accepts the per-run fixture', async () => {
		const file = 'push-group-per-run.yml';
		const source = await readFile(join(fixtures, 'negative', file), 'utf8');
		assert.deepEqual(findConcurrencyViolations(source, file), []);
	});
});

let tempRoot;
before(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), 'concurrency-test-'));
});
after(async () => {
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});
const directory = async (name, files) => {
	const dir = join(tempRoot, name);
	await mkdir(dir);
	assert.ok(Object.keys(files).length <= 3);
	for (const [file, source] of Object.entries(files)) {
		await writeFile(join(dir, file), source);
	}
	return dir;
};

describe('concurrency main', () => {
	it('passes on the repository workflows', async () => {
		assert.equal(await main(), 0);
	});
	it('refuses an empty directory', async () => {
		assert.equal(await main(await directory('empty', {})), 1);
	});
	it('refuses a missing exception file', async () => {
		const dir = await directory('missing-exception', { 'safe.yml': workflow(concurrency()) });
		assert.equal(await main(dir), 1);
	});
	it('accepts the exception plus a safe workflow', async () => {
		const dir = await directory('safe', {
			'release-please.yml': releaseWorkflow,
			'ci.yml': workflow(concurrency()),
		});
		assert.equal(await main(dir), 0);
	});
	it('refuses an unsafe workflow alongside the valid exception', async () => {
		const dir = await directory('unsafe', {
			'release-please.yml': releaseWorkflow,
			'ci.yml': workflow(concurrency(refGroup, 'false')),
		});
		assert.equal(await main(dir), 1);
	});
});

describe('concurrency main fixture exit codes', () => {
	const fixtures = join(root, '.config/hiss/testdata/HISS-18/internal');
	it('returns one for the planted cancellation fixture', async () => {
		const file = 'push-group-cancels-tip.yml';
		const source = await readFile(join(fixtures, 'positive', file), 'utf8');
		const dir = await directory('fixture-positive', {
			'release-please.yml': releaseWorkflow,
			[file]: source,
		});
		assert.equal(await main(dir), 1);
	});

	it('returns zero for the per-run fixture', async () => {
		const file = 'push-group-per-run.yml';
		const source = await readFile(join(fixtures, 'negative', file), 'utf8');
		const dir = await directory('fixture-negative', {
			'release-please.yml': releaseWorkflow,
			[file]: source,
		});
		assert.equal(await main(dir), 0);
	});
});
