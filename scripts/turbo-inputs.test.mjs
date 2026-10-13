import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const turbo = join(root, 'node_modules', '.bin', 'turbo');

/**
 * Files outside its own folder that a package's tests read, one sample per
 * glob in that package's turbo.json. Turbo hashes only the package folder by
 * default, so without these inputs a change to one of the files left the
 * cached green result of the test task in place.
 */
const READS_OUTSIDE_PACKAGE = {
	'@sveltesentio/testing': [
		'.github/workflows/ci.yml',
		'.github/workflows/codeql.yml',
		'scripts/ci-affected.mjs',
		'scripts/check-docs-drift.mjs',
		'renovate.json',
	],
	'@sveltesentio/mcp': [
		'docs/adr/README.md',
		'docs/compliance/owasp-asvs-l2.md',
		'docs/compose/admin-ui-patterns.md',
		'docs/principles.md',
		'packages/core/AGENTS.md',
		'packages/core/package.json',
	],
};

/** The files turbo hashes for the test task of one package, relative to the root. */
function testInputs(pkg) {
	const out = execFileSync(turbo, ['run', 'test', `--filter=${pkg}`, '--dry=json'], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
		maxBuffer: 16 * 1024 * 1024,
		timeout: 60_000,
	});
	const task = JSON.parse(out).tasks.find((entry) => entry.taskId === `${pkg}#test`);
	assert.ok(task, `turbo planned no test task for ${pkg}`);
	return Object.keys(task.inputs).map((file) => join(task.directory, file).replaceAll('\\', '/'));
}

describe('turbo test inputs', () => {
	for (const [pkg, files] of Object.entries(READS_OUTSIDE_PACKAGE)) {
		it(`hashes the files outside the package that ${pkg} tests read`, () => {
			const inputs = testInputs(pkg);
			for (const file of files) {
				assert.ok(existsSync(join(root, file)), `${file} no longer exists; update this list`);
				assert.ok(inputs.includes(file), `${pkg}#test does not hash ${file}`);
			}
		});
	}

	it('keeps the files of the package itself', () => {
		assert.ok(testInputs('@sveltesentio/testing').includes('packages/testing/package.json'));
	});

	it('does not hash those files for a package that does not read them', () => {
		const inputs = testInputs('@sveltesentio/core');
		assert.ok(!inputs.includes('.github/workflows/ci.yml'));
		assert.ok(!inputs.includes('docs/principles.md'));
	});
});
