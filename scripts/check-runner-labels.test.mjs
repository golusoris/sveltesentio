import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findFloatingLabels, main, scanWorkflows } from './check-runner-labels.mjs';

const ownWorkflows = join(
	fileURLToPath(new URL('.', import.meta.url)),
	'..',
	'.github',
	'workflows',
);

const job = (runsOn) => `jobs:\n  build:\n    ${runsOn}\n    steps:\n      - run: true\n`;

describe('check-runner-labels', () => {
	let tempRoot;

	before(async () => {
		tempRoot = await mkdtemp(join(tmpdir(), 'crl-test-'));
	});

	after(async () => {
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	const workflowDir = async (name, files) => {
		const dir = join(tempRoot, name);
		await mkdir(dir, { recursive: true });
		for (const [file, source] of Object.entries(files)) await writeFile(join(dir, file), source);
		return dir;
	};

	describe('findFloatingLabels', () => {
		it('accepts pinned labels', () => {
			assert.deepEqual(findFloatingLabels(job('runs-on: ubuntu-26.04')), []);
			assert.deepEqual(findFloatingLabels(job('runs-on: [self-hosted, ubuntu-24.04]')), []);
		});

		it('refuses the label as a runs-on scalar and reports the line', () => {
			assert.deepEqual(findFloatingLabels(job('runs-on: ubuntu-latest')), [
				{ line: 3, text: 'runs-on: ubuntu-latest' },
			]);
		});

		it('refuses the label quoted, in a flow list and in a block list', () => {
			assert.equal(findFloatingLabels(job('runs-on: "ubuntu-latest"')).length, 1);
			assert.equal(findFloatingLabels(job('runs-on: [self-hosted, ubuntu-latest]')).length, 1);
			assert.equal(findFloatingLabels(job('runs-on:\n      - ubuntu-latest')).length, 1);
		});

		it('refuses the label as a matrix value', () => {
			const source = [
				'jobs:',
				'  build:',
				'    strategy:',
				'      matrix:',
				'        os: [ubuntu-26.04, ubuntu-latest]',
				'    runs-on: ${{ matrix.os }}',
			].join('\n');
			assert.deepEqual(
				findFloatingLabels(source).map((finding) => finding.line),
				[5],
			);
		});

		it('reads files with CRLF line endings', () => {
			const source = job('runs-on: ubuntu-latest').replaceAll('\n', '\r\n');
			assert.deepEqual(findFloatingLabels(source), [{ line: 3, text: 'runs-on: ubuntu-latest' }]);
		});

		it('skips a whole-line comment and refuses a trailing one', () => {
			assert.deepEqual(findFloatingLabels('    # was ubuntu-latest until the pin\n'), []);
			assert.equal(findFloatingLabels(job('runs-on: ubuntu-26.04 # not ubuntu-latest')).length, 1);
		});

		it('treats a longer label that contains the name as another label', () => {
			assert.deepEqual(findFloatingLabels(job('runs-on: ubuntu-latest-xl')), []);
			assert.deepEqual(findFloatingLabels(job('runs-on: team-ubuntu-latest')), []);
			assert.deepEqual(findFloatingLabels(job('runs-on: ubuntu-latest_arm')), []);
		});

		it('returns nothing for an empty source', () => {
			assert.deepEqual(findFloatingLabels(''), []);
		});
	});

	describe('scanWorkflows', () => {
		it('reads .yml and .yaml files and names the file of each finding', async () => {
			const dir = await workflowDir('both-extensions', {
				'a.yml': job('runs-on: ubuntu-26.04'),
				'b.yaml': job('runs-on: ubuntu-latest'),
			});
			const { files, findings } = await scanWorkflows(dir);
			assert.deepEqual(files, ['a.yml', 'b.yaml']);
			assert.deepEqual(findings, [{ file: 'b.yaml', line: 3, text: 'runs-on: ubuntu-latest' }]);
		});

		it('leaves other files and sub-directories unread', async () => {
			const dir = await workflowDir('other-files', {
				'notes.md': 'runs-on: ubuntu-latest',
				'ci.yml.bak': job('runs-on: ubuntu-latest'),
			});
			await mkdir(join(dir, 'nested.yml'));
			assert.deepEqual(await scanWorkflows(dir), { files: [], findings: [] });
		});

		it('rejects a directory that does not exist', async () => {
			await assert.rejects(scanWorkflows(join(tempRoot, 'missing')), { code: 'ENOENT' });
		});
	});

	describe('main', () => {
		it('returns 0 when every workflow is pinned', async () => {
			const dir = await workflowDir('pinned', { 'ci.yml': job('runs-on: ubuntu-26.04') });
			assert.equal(await main(dir), 0);
		});

		it('returns 1 when one workflow names the floating label', async () => {
			const dir = await workflowDir('floating', {
				'ci.yml': job('runs-on: ubuntu-26.04'),
				'docs.yml': job('runs-on: ubuntu-latest'),
			});
			assert.equal(await main(dir), 1);
		});

		it('returns 1 when there is no workflow to read', async () => {
			const dir = await workflowDir('empty', {});
			assert.equal(await main(dir), 1);
		});
	});

	it('finds no floating label in the workflows of this repository', async () => {
		const { files, findings } = await scanWorkflows(ownWorkflows);
		assert.ok(files.length > 0);
		assert.deepEqual(findings, []);
	});
});
