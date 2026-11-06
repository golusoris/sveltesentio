import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
	checkTurboPassThrough,
	extractTurboTasks,
	main,
	scanWorkflows,
} from './check-playwright-image.mjs';

const VALID_IMAGE =
	'mcr.microsoft.com/playwright:v1.64.1-resolute@sha256:f76885029244e5a384243a930ff283cef67d90653978ee27a77dd4cff8882fb4';

const LOCK_YAML = 'packages:\n  playwright@1.64.1:\n    resolution: {}\n';

function makeContainerWorkflow(runCommand = 'pnpm exec turbo run test:e2e $TURBO_FILTER') {
	return [
		'jobs:',
		'  e2e:',
		'    runs-on: ubuntu-26.04',
		'    container:',
		`      image: ${VALID_IMAGE}`,
		'      options: --user 1001',
		'    env:',
		'      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright',
		'    steps:',
		`      - run: ${runCommand}`,
		'',
	].join('\n');
}

async function setupTurboFixture(tempRoot, name, options = {}) {
	const dir = join(tempRoot, name);
	await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
	if (options.lockYaml !== null) {
		await writeFile(join(dir, 'pnpm-lock.yaml'), options.lockYaml ?? LOCK_YAML);
	}
	const workflow = options.workflow ?? makeContainerWorkflow();
	await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), workflow);
	if (options.turboJson !== null) {
		await writeFile(
			join(dir, 'turbo.json'),
			typeof options.turboJson === 'string'
				? options.turboJson
				: JSON.stringify(options.turboJson ?? { tasks: { 'test:e2e': {} } }),
		);
	}
	return dir;
}

describe('check-playwright-image turbo passthrough checks', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cpi-turbo-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	describe('task extraction', () => {
		it('extracts task from pnpm exec turbo run command', () => {
			const tasks = extractTurboTasks('pnpm exec turbo run test:e2e $TURBO_FILTER');
			assert.deepEqual(tasks, ['test:e2e']);
		});

		it('extracts multiple tasks and skips flags and variables', () => {
			const cmd = 'turbo run typecheck test --filter="./packages/*" --concurrency=2';
			assert.deepEqual(extractTurboTasks(cmd), ['typecheck', 'test']);
		});

		it('returns empty array when command does not invoke turbo run', () => {
			assert.deepEqual(extractTurboTasks('pnpm test:stories'), []);
			assert.deepEqual(extractTurboTasks(null), []);
		});
	});

	describe('negative cases (missing passthrough)', () => {
		it('reports finding naming turbo.json and task when task lacks PLAYWRIGHT_BROWSERS_PATH', () => {
			const findings = checkTurboPassThrough({ tasks: { 'test:e2e': {} } }, ['test:e2e']);
			assert.equal(findings.length, 1);
			assert.equal(findings[0].file, 'turbo.json');
			assert.equal(findings[0].task, 'test:e2e');
			assert.match(findings[0].message, /turbo\.json.*test:e2e.*PLAYWRIGHT_BROWSERS_PATH/);
		});

		it('fails in scanWorkflows and main when task in turbo.json lacks passthrough', async () => {
			const dir = await setupTurboFixture(tempRoot, 'missing-passthrough', {
				turboJson: { tasks: { 'test:e2e': { dependsOn: ['build'] } } },
			});
			const { findings } = await scanWorkflows(dir, '1.64.1');
			assert.equal(findings.length, 1);
			assert.equal(findings[0].file, 'turbo.json');
			assert.match(findings[0].message, /task 'test:e2e'/);
			assert.equal(await main(dir), 1);
		});
	});

	describe('positive cases (task-level passthrough)', () => {
		it('passes when task defines passThroughEnv with PLAYWRIGHT_BROWSERS_PATH', () => {
			const config = {
				tasks: {
					'test:e2e': { passThroughEnv: ['PLAYWRIGHT_BROWSERS_PATH'] },
				},
			};
			assert.deepEqual(checkTurboPassThrough(config, ['test:e2e']), []);
		});

		it('passes when task defines env with PLAYWRIGHT_BROWSERS_PATH', () => {
			const config = {
				tasks: {
					'test:e2e': { env: ['PLAYWRIGHT_BROWSERS_PATH'] },
				},
			};
			assert.deepEqual(checkTurboPassThrough(config, ['test:e2e']), []);
		});

		it('passes in scanWorkflows and main with task-level passThroughEnv', async () => {
			const dir = await setupTurboFixture(tempRoot, 'task-passthrough', {
				turboJson: {
					tasks: {
						'test:e2e': { passThroughEnv: ['PLAYWRIGHT_BROWSERS_PATH'] },
					},
				},
			});
			const { findings } = await scanWorkflows(dir, '1.64.1');
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});
	});

	describe('positive cases (globalPassThroughEnv)', () => {
		it('passes when globalPassThroughEnv defines PLAYWRIGHT_BROWSERS_PATH', () => {
			const config = {
				globalPassThroughEnv: ['PLAYWRIGHT_BROWSERS_PATH'],
				tasks: { 'test:e2e': {} },
			};
			assert.deepEqual(checkTurboPassThrough(config, ['test:e2e']), []);
		});

		it('passes when globalEnv defines PLAYWRIGHT_BROWSERS_PATH', () => {
			const config = {
				globalEnv: ['PLAYWRIGHT_BROWSERS_PATH'],
				tasks: { 'test:e2e': {} },
			};
			assert.deepEqual(checkTurboPassThrough(config, ['test:e2e']), []);
		});

		it('passes in scanWorkflows and main with globalPassThroughEnv', async () => {
			const dir = await setupTurboFixture(tempRoot, 'global-passthrough', {
				turboJson: {
					globalPassThroughEnv: ['PLAYWRIGHT_BROWSERS_PATH'],
					tasks: { 'test:e2e': {} },
				},
			});
			const { findings } = await scanWorkflows(dir, '1.64.1');
			assert.deepEqual(findings, []);
			assert.equal(await main(dir), 0);
		});
	});

	describe('boundary cases (missing turbo.json)', () => {
		it('fails in scanWorkflows and main when container job exists and turbo.json is missing', async () => {
			const dir = await setupTurboFixture(tempRoot, 'missing-turbo', {
				turboJson: null,
			});
			const { findings } = await scanWorkflows(dir, '1.64.1');
			assert.equal(findings.length, 1);
			assert.equal(findings[0].file, 'turbo.json');
			assert.match(findings[0].message, /failed to read .*turbo\.json/);
			assert.equal(await main(dir), 1);
		});

		it('reports finding when turbo.json is malformed JSON', async () => {
			const dir = await setupTurboFixture(tempRoot, 'malformed-turbo', {
				turboJson: '{ not valid json',
			});
			const { findings } = await scanWorkflows(dir, '1.64.1');
			assert.equal(findings.length, 1);
			assert.equal(findings[0].file, 'turbo.json');
			assert.match(findings[0].message, /failed to parse .*turbo\.json/);
			assert.equal(await main(dir), 1);
		});
	});
});
