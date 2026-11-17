import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	findJobTimeoutViolations,
	INSTALL_MIN_TIMEOUT_MINUTES,
	main,
	scanWorkflows,
	STEP_LIMIT,
} from './check-job-timeouts.mjs';

const ownWorkflows = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
);

const hissFixtures = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.config',
	'hiss',
	'testdata',
	'HISS-02',
	'internal',
);

const makeJob = (body) => `jobs:\n  test:\n    ${body}\n    steps:\n      - run: true\n`;
const installJob = (timeout, run = 'pnpm install --frozen-lockfile') =>
	`jobs:\n  install:\n    timeout-minutes: ${timeout}\n    steps:\n      - run: ${run}\n`;

describe('install timeout floor', () => {
	it('refuses an install at nine minutes with file, job, value and bound', () => {
		const findings = findJobTimeoutViolations(installJob(9), 'short.yml');
		assert.equal(findings.length, 1);
		assert.equal(findings[0].file, 'short.yml');
		assert.equal(findings[0].job, 'install');
		assert.match(findings[0].message, /short.yml: job 'install'.*10.*9/);
	});

	it('accepts an install at ten minutes', () => {
		assert.equal(INSTALL_MIN_TIMEOUT_MINUTES, 10);
		assert.deepEqual(findJobTimeoutViolations(installJob(10)), []);
	});

	it('accepts five minutes without a pnpm install', () => {
		for (const run of ['true', 'pnpm add yaml', 'npm install']) {
			assert.deepEqual(findJobTimeoutViolations(installJob(5, run)), []);
		}
	});

	it('recognizes the pnpm i shorthand and multiline commands', () => {
		assert.equal(findJobTimeoutViolations(installJob(9, 'pnpm i')).length, 1);
		assert.equal(
			findJobTimeoutViolations(
				installJob(9, '|\n          corepack enable\n          pnpm install'),
			).length,
			1,
		);
	});
});

describe('install timeout aliases and step bounds', () => {
	it('resolves an install anchor reused by a short job', () => {
		const source = [
			'jobs:',
			'  first:',
			'    timeout-minutes: 10',
			'    steps:',
			'      - &pnpm_install',
			'        run: corepack enable && pnpm install --frozen-lockfile',
			'  short:',
			'    timeout-minutes: 5',
			'    steps:',
			'      - *pnpm_install',
		].join('\n');
		const findings = findJobTimeoutViolations(source, 'anchor.yml');
		assert.equal(findings.length, 1);
		assert.equal(findings[0].job, 'short');
	});

	it('bounds the step sequence at STEP_LIMIT', () => {
		const steps = '      - run: true\n'.repeat(STEP_LIMIT);
		const source = `jobs:\n  test:\n    timeout-minutes: 10\n    steps:\n${steps}`;
		assert.deepEqual(findJobTimeoutViolations(source), []);
		assert.throws(
			() => findJobTimeoutViolations(`${source}      - run: true\n`, 'large.yml'),
			/large.yml: job 'test' exceeds limit of 1000 steps/,
		);
	});

	it('refuses a malformed step sequence', () => {
		const findings = findJobTimeoutViolations(
			'jobs:\n  test:\n    timeout-minutes: 10\n    steps: {}\n',
		);
		assert.match(findings[0].message, /steps must be a YAML sequence/);
	});
});

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
		assert.ok(Object.keys(files).length <= 3);
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
		it('uses the supplied rule for each workflow', async () => {
			const source = makeJob('timeout-minutes: 5');
			const dir = await workflowDir('custom-rule', { 'one.yml': source });
			const finding = { file: 'one.yml', job: null, message: 'planted finding' };
			const result = await scanWorkflows(dir, (text, file) => {
				assert.equal(text, source);
				assert.equal(file, 'one.yml');
				return [finding];
			});
			assert.deepEqual(result, { files: ['one.yml'], findings: [finding] });
		});

		it('accepts an empty result from a supplied rule', async () => {
			const dir = await workflowDir('custom-clean', { 'one.yml': makeJob('timeout-minutes: 5') });
			assert.deepEqual(await scanWorkflows(dir, () => []), { files: ['one.yml'], findings: [] });
		});

		it('refuses a rule result above its per-workflow bound', async () => {
			const dir = await workflowDir('custom-overflow', {
				'one.yml': makeJob('timeout-minutes: 5'),
			});
			await assert.rejects(
				scanWorkflows(dir, () => Array.from({ length: 103 }, () => ({}))),
				/one.yml: rule returned more than 102 findings/,
			);
		});

		it('accepts a rule result exactly at its per-workflow bound', async () => {
			const dir = await workflowDir('custom-boundary', {
				'one.yml': makeJob('timeout-minutes: 5'),
			});
			const findings = Array.from({ length: 102 }, () => ({
				file: 'one.yml',
				job: null,
				message: 'planted',
			}));
			assert.deepEqual((await scanWorkflows(dir, () => findings)).findings, findings);
		});

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

	describe('HISS-02 coverage fixtures', () => {
		it('refuses the install fixture itself, even if another fixture already fails', async () => {
			const file = 'install-job-short-timeout.yml';
			const source = await readFile(join(hissFixtures, 'positive', file), 'utf8');
			const findings = findJobTimeoutViolations(source, file);
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /pnpm install.*10.*9/);
		});

		it('refuses the positive fixture (job without timeout-minutes)', async () => {
			assert.equal(await main(join(hissFixtures, 'positive')), 1);
		});

		it('accepts the negative fixture (job with timeout-minutes)', async () => {
			assert.equal(await main(join(hissFixtures, 'negative')), 0);
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

	describe('jobTimeoutMessage', () => {
		it('refuses non-mapping job definitions (null, list, scalar)', () => {
			for (const body of ['null', '[step]', 'scalar']) {
				const findings = findJobTimeoutViolations(`jobs:\n  bad: ${body}\n`, 'ci.yml');
				assert.equal(findings.length, 1);
				assert.equal(findings[0].job, 'bad');
				assert.match(findings[0].message, /job 'bad' must be a YAML mapping/);
			}
		});

		it('treats blank or non-string uses as a standard job requiring timeout-minutes', () => {
			const blankUses = makeJob('runs-on: ubuntu-26.04\n    uses: "   "');
			const missing = findJobTimeoutViolations(blankUses, 'ci.yml');
			assert.equal(missing.length, 1);
			assert.match(missing[0].message, /missing required integer 'timeout-minutes'/);

			const numericUses = makeJob('uses: 123\n    timeout-minutes: 5');
			assert.deepEqual(findJobTimeoutViolations(numericUses, 'ci.yml'), []);
		});

		it('refuses reusable workflow call when timeout-minutes key is present with null', () => {
			const source = [
				'jobs:',
				'  reusable:',
				'    uses: ./.github/workflows/reusable.yml',
				'    timeout-minutes: null',
			].join('\n');
			const findings = findJobTimeoutViolations(source, 'caller.yml');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /calls a reusable workflow and cannot declare/);
		});

		it('refuses null timeout-minutes on a standard job as missing', () => {
			const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: null');
			const findings = findJobTimeoutViolations(source, 'test.yml');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /missing required integer 'timeout-minutes'/);
		});

		it('formats non-string non-integer timeout-minutes via String()', () => {
			const source = makeJob('runs-on: ubuntu-26.04\n    timeout-minutes: true');
			const findings = findJobTimeoutViolations(source, 'test.yml');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /must be an integer, got true$/);
		});
	});
});
