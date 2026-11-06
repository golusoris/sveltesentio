import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	findPlaywrightImageViolations,
	getPlaywrightLockVersion,
	main,
	readLockfileVersion,
	scanWorkflows,
} from './check-playwright-image.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const VALID_IMAGE =
	'mcr.microsoft.com/playwright:v1.64.1-resolute@sha256:f76885029244e5a384243a930ff283cef67d90653978ee27a77dd4cff8882fb4';

const makeWorkflow = (body) => `jobs:\n  test:\n    ${body}\n`;

function appendContainerConfig(lines, overrides) {
	if (overrides.container !== undefined) {
		lines.push(overrides.container);
		return;
	}
	lines.push('container:', `  image: ${overrides.image ?? VALID_IMAGE}`);
	lines.push(`  options: ${overrides.options ?? '--user 1001'}`);
	if (overrides.containerEnv) {
		lines.push('  env:', `    PLAYWRIGHT_BROWSERS_PATH: ${overrides.containerEnv}`);
	}
}

function appendJobEnv(lines, overrides) {
	if (overrides.jobEnv !== undefined) {
		if (overrides.jobEnv !== null) {
			lines.push('env:', `  PLAYWRIGHT_BROWSERS_PATH: ${overrides.jobEnv}`);
		}
	} else if (!overrides.containerEnv) {
		lines.push('env:', '  PLAYWRIGHT_BROWSERS_PATH: /ms-playwright');
	}
}

function appendSteps(lines, steps) {
	lines.push('steps:');
	if (Array.isArray(steps)) {
		for (const step of steps) {
			lines.push(`  - run: ${step}`);
		}
	} else if (typeof steps === 'string') {
		lines.push(steps);
	} else {
		lines.push('  - run: echo ok');
	}
}

function makeValidJob(overrides = {}) {
	const lines = ['runs-on: ubuntu-26.04'];
	appendContainerConfig(lines, overrides);
	appendJobEnv(lines, overrides);
	appendSteps(lines, overrides.steps);
	return makeWorkflow(lines.join('\n    '));
}

describe('check-playwright-image', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'cpi-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	const setupDir = async (name, lockYaml, workflowFiles) => {
		const dir = join(tempRoot, name);
		await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
		if (lockYaml !== null) {
			await writeFile(join(dir, 'pnpm-lock.yaml'), lockYaml);
		}
		for (const [file, source] of Object.entries(workflowFiles)) {
			await writeFile(join(dir, '.github', 'workflows', file), source);
		}
		return dir;
	};

	describe('positive cases', () => {
		it('accepts job with job-level PLAYWRIGHT_BROWSERS_PATH', () => {
			const source = makeValidJob();
			assert.deepEqual(findPlaywrightImageViolations(source, 'ci.yml', '1.64.1'), []);
		});

		it('accepts job with container-level PLAYWRIGHT_BROWSERS_PATH', () => {
			const source = makeValidJob({ containerEnv: '/ms-playwright' });
			assert.deepEqual(findPlaywrightImageViolations(source, 'ci.yml', '1.64.1'), []);
		});

		it('accepts container options with full user:group and flags', () => {
			const sourceUserGroup = makeValidJob({ options: '--user 1001:1001' });
			assert.deepEqual(findPlaywrightImageViolations(sourceUserGroup, 'ci.yml', '1.64.1'), []);

			const sourceIpc = makeValidJob({ options: '--ipc=host --user 1001' });
			assert.deepEqual(findPlaywrightImageViolations(sourceIpc, 'ci.yml', '1.64.1'), []);
		});
	});

	describe('boundary cases', () => {
		it('handles image as plain string form and reports missing options and env', () => {
			const source = makeWorkflow(
				['runs-on: ubuntu-26.04', `container: ${VALID_IMAGE}`, 'steps:', '  - run: echo ok'].join(
					'\n    ',
				),
			);
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 2);
			assert.match(findings[0].message, /container options lacks required '--user 1001'/);
			assert.match(findings[1].message, /missing required env\.PLAYWRIGHT_BROWSERS_PATH/);
		});

		it('passes when workflow has no container', () => {
			const source = makeWorkflow(
				[
					'runs-on: ubuntu-26.04',
					'steps:',
					'  - run: pnpm exec playwright install --with-deps chromium',
				].join('\n    '),
			);
			assert.deepEqual(findPlaywrightImageViolations(source, 'ci-sveltekit.yml', '1.64.1'), []);
		});

		it('passes when container image is not from Playwright', () => {
			const source = makeWorkflow(
				['runs-on: ubuntu-26.04', 'container:', '  image: node:20', 'steps:', '  - run: true'].join(
					'\n    ',
				),
			);
			assert.deepEqual(findPlaywrightImageViolations(source, 'ci.yml', '1.64.1'), []);
		});
	});

	describe('negative cases: env and options', () => {
		it('detects missing PLAYWRIGHT_BROWSERS_PATH', () => {
			const source = makeValidJob({ jobEnv: null });
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 1);
			assert.match(
				findings[0].message,
				/missing required env\.PLAYWRIGHT_BROWSERS_PATH: '\/ms-playwright'/,
			);
		});

		it('detects invalid PLAYWRIGHT_BROWSERS_PATH value', () => {
			const source = makeValidJob({ jobEnv: '/other' });
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 1);
			assert.match(
				findings[0].message,
				/env\.PLAYWRIGHT_BROWSERS_PATH must be '\/ms-playwright', got '\/other'/,
			);
		});

		it('refuses --user 10010 and --user 1001foo substring matches', () => {
			const source10010 = makeValidJob({ options: '--user 10010' });
			const findings10010 = findPlaywrightImageViolations(source10010, 'ci.yml', '1.64.1');
			assert.equal(findings10010.length, 1);
			assert.match(findings10010[0].message, /container options lacks required '--user 1001'/);

			const sourceFoo = makeValidJob({ options: '--user 1001foo' });
			const findingsFoo = findPlaywrightImageViolations(sourceFoo, 'ci.yml', '1.64.1');
			assert.equal(findingsFoo.length, 1);
			assert.match(findingsFoo[0].message, /container options lacks required '--user 1001'/);
		});

		it('detects options missing --user', () => {
			const source = makeValidJob({ options: '--ipc=host' });
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /container options lacks required '--user 1001'/);
		});
	});

	describe('negative cases: image tags, digest, and steps', () => {
		it('detects tag v1.63.0 vs lock 1.64.1', () => {
			const badTagImage =
				'mcr.microsoft.com/playwright:v1.63.0@sha256:f76885029244e5a384243a930ff283cef67d90653978ee27a77dd4cff8882fb4';
			const source = makeValidJob({ image: badTagImage });
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /tag version 'v1.63.0' \(1.63.0\) does not match lockfile/);
		});

		it('detects tag without digest', () => {
			const source = makeValidJob({ image: 'mcr.microsoft.com/playwright:v1.64.1-resolute' });
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 1);
			assert.match(findings[0].message, /missing required '@sha256:<64 hex>' digest/);
		});

		it('detects leftover install --with-deps inside container job', () => {
			const source = makeValidJob({
				steps: '  - run: pnpm exec playwright install --with-deps chromium',
			});
			const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
			assert.equal(findings.length, 1);
			assert.match(
				findings[0].message,
				/contains redundant 'playwright install --with-deps' inside Playwright container/,
			);
		});
	});

	describe('HISS-02 scalar caps', () => {
		it('enforces LOCK_DOC_LIMIT boundary on lockfile documents', () => {
			const twoDocs =
				'packages:\n  playwright@1.64.1:\n    resolution: {}\n---\npackages:\n  foo@1.0.0:\n    resolution: {}\n';
			const passResult = getPlaywrightLockVersion(twoDocs, { docLimit: 2 });
			assert.equal(passResult.version, '1.64.1');
			assert.equal(passResult.finding, null);

			const failResult = getPlaywrightLockVersion(twoDocs, { docLimit: 1 });
			assert.equal(failResult.version, null);
			assert.match(failResult.finding.message, /exceeds limit of 1 documents, got 2/);
		});

		it('enforces LOCK_PACKAGE_LIMIT boundary on lockfile packages', () => {
			const twoPkgs =
				'packages:\n  playwright@1.64.1:\n    resolution: {}\n  foo@1.0.0:\n    resolution: {}\n';
			const passResult = getPlaywrightLockVersion(twoPkgs, { packageLimit: 2 });
			assert.equal(passResult.version, '1.64.1');
			assert.equal(passResult.finding, null);

			const failResult = getPlaywrightLockVersion(twoPkgs, { packageLimit: 1 });
			assert.equal(failResult.version, null);
			assert.match(failResult.finding.message, /exceeds limit of 1 packages, got 2/);
		});

		it('enforces STEP_LIMIT boundary on workflow job steps', () => {
			const passSource = makeValidJob({ steps: ['echo 1', 'echo 2'] });
			assert.deepEqual(
				findPlaywrightImageViolations(passSource, 'ci.yml', '1.64.1', { stepLimit: 2 }),
				[],
			);

			const failSource = makeValidJob({ steps: ['echo 1', 'echo 2', 'echo 3'] });
			assert.throws(
				() => findPlaywrightImageViolations(failSource, 'ci.yml', '1.64.1', { stepLimit: 2 }),
				/job 'test' exceeds limit of 2 steps, got 3/,
			);
		});
	});

	describe('getPlaywrightLockVersion', () => {
		it('extracts resolved version from single document lockfile', () => {
			const yaml = 'packages:\n  playwright@1.64.1:\n    resolution: {}\n';
			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, '1.64.1');
			assert.equal(result.finding, null);
		});

		it('detects two playwright versions in lockfile', () => {
			const yaml = [
				'packages:',
				'  playwright@1.64.1:',
				'    resolution: {}',
				'  playwright@1.63.0:',
				'    resolution: {}',
			].join('\n');
			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, null);
			assert.match(result.finding.message, /expected exactly one playwright version/);
		});

		it('reports finding when no playwright version is in lockfile', () => {
			const yaml = 'packages:\n  vitest@5.0.5:\n    resolution: {}\n';
			const result = getPlaywrightLockVersion(yaml);
			assert.equal(result.version, null);
			assert.match(result.finding.message, /no resolved playwright package/);
		});
	});

	describe('scanWorkflows and main integration', () => {
		it('returns 0 for clean temporary directory setup', async () => {
			const lockYaml = 'packages:\n  playwright@1.64.1:\n    resolution: {}\n';
			const workflow = makeValidJob();
			const dir = await setupDir('clean', lockYaml, { 'ci.yml': workflow });
			const rc = await main(dir);
			assert.equal(rc, 0);
		});

		it('returns 1 when workflow directory has no workflows', async () => {
			const emptyDir = join(tempRoot, 'empty');
			await mkdir(join(emptyDir, '.github', 'workflows'), { recursive: true });
			await writeFile(
				join(emptyDir, 'pnpm-lock.yaml'),
				'packages:\n  playwright@1.64.1:\n    resolution: {}\n',
			);
			const rc = await main(emptyDir);
			assert.equal(rc, 1);
		});
	});

	describe('repository workflows', () => {
		it('passes on all real workflows in .github/workflows with root pnpm-lock.yaml', async () => {
			const lockResult = await readLockfileVersion(root);
			assert.equal(lockResult.finding, null);
			assert.ok(lockResult.version, 'resolved lockfile version must exist');
			const { files, findings } = await scanWorkflows(root, lockResult.version);
			assert.ok(files.length > 0, 'at least one workflow was read');
			assert.deepEqual(
				findings,
				[],
				`Expected zero violations in ${root}, got:\n${findings.map((f) => `  ${f.file} (${f.job}): ${f.message}`).join('\n')}`,
			);
		});

		it('main() returns exit code 0 on the repository', async () => {
			const rc = await main(root);
			assert.equal(rc, 0);
		});
	});
});
