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
	scanWorkflows,
} from './check-playwright-image.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const VALID_IMAGE =
	'mcr.microsoft.com/playwright:v1.64.1-resolute@sha256:f76885029244e5a384243a930ff283cef67d90653978ee27a77dd4cff8882fb4';

const makeWorkflow = (body) => `jobs:\n  test:\n    ${body}\n`;

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

	describe('findPlaywrightImageViolations', () => {
		describe('positive cases', () => {
			it('accepts job with valid image, digest, options, and steps', () => {
				const source = makeWorkflow(
					[
						'runs-on: ubuntu-26.04',
						'container:',
						`  image: ${VALID_IMAGE}`,
						'  options: --user 1001',
						'steps:',
						'  - run: echo ok',
					].join('\n    '),
				);
				assert.deepEqual(findPlaywrightImageViolations(source, 'ci.yml', '1.64.1'), []);
			});
		});

		describe('boundary cases', () => {
			it('handles image as plain string form and reports missing options', () => {
				const source = makeWorkflow(
					['runs-on: ubuntu-26.04', `container: ${VALID_IMAGE}`, 'steps:', '  - run: echo ok'].join(
						'\n    ',
					),
				);
				const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
				assert.equal(findings.length, 1);
				assert.match(findings[0].message, /container options lacks required '--user 1001'/);
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
					[
						'runs-on: ubuntu-26.04',
						'container:',
						'  image: node:20',
						'steps:',
						'  - run: true',
					].join('\n    '),
				);
				assert.deepEqual(findPlaywrightImageViolations(source, 'ci.yml', '1.64.1'), []);
			});
		});

		describe('negative cases', () => {
			it('detects tag v1.63.0 vs lock 1.64.1', () => {
				const badTagImage =
					'mcr.microsoft.com/playwright:v1.63.0@sha256:f76885029244e5a384243a930ff283cef67d90653978ee27a77dd4cff8882fb4';
				const source = makeWorkflow(
					[
						'runs-on: ubuntu-26.04',
						'container:',
						`  image: ${badTagImage}`,
						'  options: --user 1001',
						'steps:',
						'  - run: echo ok',
					].join('\n    '),
				);
				const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
				assert.equal(findings.length, 1);
				assert.match(
					findings[0].message,
					/tag version 'v1.63.0' \(1.63.0\) does not match lockfile/,
				);
			});

			it('detects tag without digest', () => {
				const source = makeWorkflow(
					[
						'runs-on: ubuntu-26.04',
						'container:',
						'  image: mcr.microsoft.com/playwright:v1.64.1-resolute',
						'  options: --user 1001',
						'steps:',
						'  - run: echo ok',
					].join('\n    '),
				);
				const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
				assert.equal(findings.length, 1);
				assert.match(findings[0].message, /missing required '@sha256:<64 hex>' digest/);
			});

			it('detects options missing --user', () => {
				const source = makeWorkflow(
					[
						'runs-on: ubuntu-26.04',
						'container:',
						`  image: ${VALID_IMAGE}`,
						'  options: --ipc=host',
						'steps:',
						'  - run: echo ok',
					].join('\n    '),
				);
				const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
				assert.equal(findings.length, 1);
				assert.match(findings[0].message, /container options lacks required '--user 1001'/);
			});

			it('detects leftover install --with-deps inside container job', () => {
				const source = makeWorkflow(
					[
						'runs-on: ubuntu-26.04',
						'container:',
						`  image: ${VALID_IMAGE}`,
						'  options: --user 1001',
						'steps:',
						'  - run: pnpm exec playwright install --with-deps chromium',
					].join('\n    '),
				);
				const findings = findPlaywrightImageViolations(source, 'ci.yml', '1.64.1');
				assert.equal(findings.length, 1);
				assert.match(
					findings[0].message,
					/contains redundant 'playwright install --with-deps' inside Playwright container/,
				);
			});
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
			const workflow = makeWorkflow(
				[
					'runs-on: ubuntu-26.04',
					'container:',
					`  image: ${VALID_IMAGE}`,
					'  options: --user 1001',
					'steps:',
					'  - run: echo ok',
				].join('\n    '),
			);
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
			const { files, findings } = await scanWorkflows(root, '1.64.1');
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
