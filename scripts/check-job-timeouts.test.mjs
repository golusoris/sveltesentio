import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findJobTimeoutViolations, main, scanWorkflows } from './check-job-timeouts.mjs';

const ownWorkflows = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
);

const makeJob = (body) => `jobs:\n  test:\n    ${body}\n    steps:\n      - run: true\n`;

describe('check-job-timeouts', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cjt-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	const workflowDir = async (name, files) => {
		const dir = join(tempRoot, name);
		await mkdir(dir, { recursive: true });
		for (const [file, source] of Object.entries(files)) {
			await writeFile(join(dir, file), source);
		}
		return dir;
	};

	describe('findJobTimeoutViolations', () => {
		describe('positive cases', () => {
			it('accepts jobs with valid integer timeout-minutes', () => {
				const source = [
					'jobs:',
					'  lint:',
					'    runs-on: ubuntu-26.04',
					'    timeout-minutes: 10',
					'    steps:',
					'      - run: true',
					'  test:',
					'    runs-on: ubuntu-26.04',
					'    timeout-minutes: 60',
					'    steps:',
					'      - run: true',
				].join('\n');
				assert.deepEqual(findJobTimeoutViolations(source, 'ci.yml'), []);
			});
		});

		describe('boundary cases', () => {
			it('accepts boundary timeout-minutes: 1 (minimum allowed)', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 1');
				assert.deepEqual(findJobTimeoutViolations(source, 'test.yml'), []);
			});

			it('accepts boundary timeout-minutes: 120 (maximum allowed)', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 120');
				assert.deepEqual(findJobTimeoutViolations(source, 'test.yml'), []);
			});
		});

		describe('reusable workflow call cases', () => {
			it('skips reusable workflow calls (uses:) without timeout-minutes', () => {
				const source = [
					'jobs:',
					'  reusable:',
					'    name: Call shared workflow',
					'    uses: ./.github/workflows/reusable.yml',
					'    with:',
					'      node-version: "24"',
				].join('\n');
				assert.deepEqual(findJobTimeoutViolations(source, 'caller.yml'), []);
			});

			it('refuses reusable workflow calls declaring timeout-minutes (unsupported key)', () => {
				const source = [
					'jobs:',
					'  reusable:',
					'    uses: ./.github/workflows/reusable.yml',
					'    timeout-minutes: 15',
				].join('\n');
				const findings = findJobTimeoutViolations(source, 'caller.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'reusable');
				assert.match(
					findings[0].message,
					/calls a reusable workflow and cannot declare timeout-minutes/,
				);
			});
		});

		describe('negative cases', () => {
			it('detects missing timeout-minutes', () => {
				const source = makeJob('runs-on: ubuntu-26.04');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /missing required integer 'timeout-minutes'/);
			});

			it('refuses timeout-minutes: 0 (below boundary)', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 0');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /between 1 and 120, got 0/);
			});

			it('refuses timeout-minutes: 121 (above boundary)', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 121');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /between 1 and 120, got 121/);
			});

			it('refuses string timeout-minutes: "10"', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: "10"');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /must be an integer, got "10"/);
			});

			it('refuses expression timeout-minutes: ${{ inputs.timeout }}', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: ${{ inputs.timeout }}');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /must be an integer, got "\${{ inputs.timeout }}"/);
			});

			it('refuses floating-point timeout-minutes: 10.5', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 10.5');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /must be an integer, got 10.5/);
			});

			it('refuses negative timeout-minutes: -5', () => {
				const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: -5');
				const findings = findJobTimeoutViolations(source, 'test.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'test');
				assert.match(findings[0].message, /between 1 and 120, got -5/);
			});

			it('refuses non-mapping workflow or missing jobs', () => {
				assert.match(
					findJobTimeoutViolations('hello', 'test.yml')[0].message,
					/must be a YAML mapping/,
				);
				assert.match(
					findJobTimeoutViolations('name: test\n', 'test.yml')[0].message,
					/'jobs' must be a YAML mapping/,
				);
			});

			it('refuses duplicate keys in workflow YAML', () => {
				const source = 'name: one\nname: two\njobs:\n  test:\n    timeout-minutes: 10\n';
				assert.throws(() => findJobTimeoutViolations(source, 'dup.yml'), /Map keys must be unique/);
			});
		});
	});

	describe('scanWorkflows', () => {
		it('reads directory and reports file and job of each finding', async () => {
			const dir = await workflowDir('scan-test', {
				'clean.yml': makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 15'),
				'bad.yaml': makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: 0'),
			});
			const { files, findings } = await scanWorkflows(dir);
			assert.deepEqual(files, ['bad.yaml', 'clean.yml']);
			assert.equal(findings.length, 1);
			assert.equal(findings[0].file, 'bad.yaml');
			assert.equal(findings[0].job, 'test');
		});

		it('reports error on empty directory', async () => {
			const dir = await workflowDir('empty-dir', {});
			const rc = await main(dir);
			assert.equal(rc, 1);
		});
	});

	describe('repository workflows', () => {
		it('passes on all real workflows in .github/workflows', async () => {
			const { files, findings } = await scanWorkflows(ownWorkflows);
			assert.ok(files.length > 0, 'at least one workflow was read');
			assert.deepEqual(
				findings,
				[],
				`Expected zero timeout violations in ${ownWorkflows}, got:\n${findings.map((f) => `  ${f.file} (${f.job}): ${f.message}`).join('\n')}`,
			);
		});
	});
});
