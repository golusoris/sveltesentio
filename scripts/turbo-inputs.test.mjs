import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const turbo = join(root, 'node_modules', '.bin', 'turbo');

/**
 * Files outside its own folder that a package task reads, one sample per glob
 * in that package's turbo.json. Turbo hashes only the package folder by
 * default, so without these inputs a change to one of the files left the
 * cached green result of the task in place.
 */
const READS_OUTSIDE_PACKAGE = {
	'@sveltesentio/testing#test': [
		'.github/workflows/ci.yml',
		'.github/workflows/codeql.yml',
		'scripts/ci-affected.mjs',
		'scripts/check-docs-drift.mjs',
		'renovate.json',
	],
	'@sveltesentio/mcp#test': [
		'docs/adr/README.md',
		'docs/compliance/owasp-asvs-l2.md',
		'docs/compose/admin-ui-patterns.md',
		'docs/principles.md',
		'packages/core/AGENTS.md',
		'packages/core/package.json',
	],
	'@sveltesentio/docs#build': [
		'docs/principles.md',
		'docs/adr/README.md',
		'packages/core/package.json',
	],
};

/** The files turbo hashes for one `package#task`, relative to the root. */
function taskInputs(taskId) {
	const [pkg, name] = taskId.split('#');
	const out = execFileSync(turbo, ['run', name, `--filter=${pkg}`, '--dry=json'], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
		maxBuffer: 16 * 1024 * 1024,
		timeout: 60_000,
	});
	const task = JSON.parse(out).tasks.find((entry) => entry.taskId === taskId);
	assert.ok(task, `turbo planned no task ${taskId}`);
	return Object.keys(task.inputs).map((file) => join(task.directory, file).replaceAll('\\', '/'));
}

describe('turbo task inputs', () => {
	for (const [taskId, files] of Object.entries(READS_OUTSIDE_PACKAGE)) {
		it(`hashes the files outside the package that ${taskId} reads`, () => {
			const inputs = taskInputs(taskId);
			for (const file of files) {
				assert.ok(existsSync(join(root, file)), `${file} no longer exists; update this list`);
				assert.ok(inputs.includes(file), `${taskId} does not hash ${file}`);
			}
		});
	}

	it('keeps the files of the package itself', () => {
		assert.ok(taskInputs('@sveltesentio/testing#test').includes('packages/testing/package.json'));
	});

	it('does not hash those files for a package that does not read them', () => {
		const inputs = taskInputs('@sveltesentio/core#test');
		assert.ok(!inputs.includes('.github/workflows/ci.yml'));
		assert.ok(!inputs.includes('docs/principles.md'));
	});
});
