import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { EXCERPT_LINES, PROBE_TIMEOUT_MS, ensureImage, userArgs } from './container-check.mjs';
import { RENOVATE_IMAGE, ensureImage as ensureRenovateImage } from './check-renovate-config.mjs';
import { MUST_SUCCEED } from './ci-gate.mjs';
import {
	ACTIONLINT_IMAGE,
	LINT_TIMEOUT_MS,
	MAX_WORKFLOWS,
	PLANTED_FILE,
	PLANTED_MARKERS,
	WORST_CASE_MS,
	judgeLint,
	linterArgs,
	main,
	workflowFiles,
} from './check-workflows.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const IDS = { uid: 1000, gid: 100 };
// Independent literals: changing the module constants must not change these fixtures.
const CONFIG_ARGS = ['-config-file', '.github/actionlint.yaml'];
const LIST = () => ['codeql.yaml', 'README.md', 'ci.yml'];
const LISTED = ['.github/workflows/ci.yml', '.github/workflows/codeql.yaml'];
const OK = { status: 0, signal: null, error: undefined, output: '' };
const FAILED = { ...OK, status: 1, output: 'no such image' };
// Independent literals: weakening PLANTED_MARKERS must not weaken these fixtures.
const STEPS_MARKER = '"steps" section is missing in job';
const SHELLCHECK_MARKER = '[shellcheck]';
const NEEDS_MARKER = '[job-needs]';
const PLANTED_REFUSED = {
	...FAILED,
	output:
		`${STEPS_MARKER} "stepless" [syntax-check]\nshellcheck SC2086 ${SHELLCHECK_MARKER}\n` +
		`job "orphan" needs job "absent" which does not exist in this workflow ${NEEDS_MARKER}`,
};
const TIMED_OUT = {
	...OK,
	status: null,
	signal: 'SIGKILL',
	error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }),
};

/** A stub runner answering each call by its runtime and first argument. */
function stubRunner(answers) {
	const calls = [];
	const runner = (file, args, options) => {
		calls.push({ file, args, options });
		const answer = answers[`${file} ${args[0]}`] ?? FAILED;
		return typeof answer === 'function' ? answer(args) : answer;
	};
	return { calls, runner };
}

/** Answers two lint runs independently, with a prepared Docker image. */
function lintRunner(planted = PLANTED_REFUSED, repository = OK) {
	return stubRunner({
		'docker version': OK,
		'docker image': OK,
		'docker run': (args) => (args.at(-1) === PLANTED_FILE ? planted : repository),
	});
}

describe('workflow lint: positive', () => {
	it('P1 lints the planted file first, then all workflows, with explicit user IDs', () => {
		const { calls, runner } = lintRunner();
		assert.equal(main('/src/repo', runner, { CI: 'true' }, IDS, LIST), 0);
		const runs = calls.filter((call) => call.args[0] === 'run');
		assert.equal(runs.length, 2);
		assert.deepEqual(runs[0].args.slice(-3), [...CONFIG_ARGS, PLANTED_FILE]);
		assert.deepEqual(runs[1].args.slice(-4), [...CONFIG_ARGS, ...LISTED]);
		assert.ok(!runs[1].args.includes(PLANTED_FILE));
		for (const call of runs) {
			const userIndex = call.args.indexOf('--user');
			assert.ok(userIndex > 0);
			assert.deepEqual(call.args.slice(userIndex, userIndex + 2), ['--user', '1000:100']);
			assert.equal(call.options.timeout, LINT_TIMEOUT_MS);
		}
		const names = runs.map((call) => call.args[call.args.indexOf('--name') + 1]);
		assert.equal(new Set(names).size, 2);
		for (const name of names) {
			const prefix = `workflow-lint-check-${process.pid}-`;
			assert.ok(name.startsWith(prefix));
			assert.match(name.slice(prefix.length), /^[0-9a-f]{8}$/);
		}
		assert.deepEqual(PLANTED_MARKERS, [STEPS_MARKER, SHELLCHECK_MARKER, NEEDS_MARKER]);
		assert.deepEqual(judgeLint('planted', false, PLANTED_REFUSED), []);
		assert.deepEqual(judgeLint('repository', true, OK), []);
	});

	it('P2 builds exact isolated linter arguments for planted and repository runs', () => {
		const base = [
			'run',
			'--rm',
			'--name',
			'workflow-test',
			'--network',
			'none',
			'--read-only',
			'--tmpfs',
			'/tmp',
			'--security-opt',
			'label=disable',
			'--user',
			'1000:100',
			'--mount',
			'type=bind,source=/src/repo,target=/repo,readonly',
			'--workdir',
			'/repo',
			'--entrypoint',
			'/usr/local/bin/actionlint',
			ACTIONLINT_IMAGE,
			'-no-color',
			'-oneline',
			...CONFIG_ARGS,
		];
		const user = ['--user', '1000:100'];
		assert.deepEqual(linterArgs('/src/repo', 'workflow-test', [PLANTED_FILE], user), [
			...base,
			PLANTED_FILE,
		]);
		assert.deepEqual(linterArgs('/src/repo', 'workflow-test', LISTED, user), [...base, ...LISTED]);
	});

	it('P3 maps Docker and Podman identities and supports platforms without IDs', () => {
		assert.deepEqual(userArgs('docker', IDS), ['--user', '1000:100']);
		assert.deepEqual(userArgs('podman', IDS), ['--userns=keep-id']);
		assert.deepEqual(userArgs('docker', null), []);
		assert.deepEqual(userArgs('podman', null), []);
	});

	it('P4 pins a release digest matched by exactly one Renovate manager', () => {
		assert.match(
			ACTIONLINT_IMAGE,
			/^docker\.io\/rhysd\/actionlint:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
		);
		const config = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
		const FILE_PATTERN = /^scripts\/check-workflows\.mjs$/;
		const MATCH_STRING =
			/'(?<depName>docker\.io\/rhysd\/actionlint):(?<currentValue>\d+\.\d+\.\d+)@(?<currentDigest>sha256:[0-9a-f]{64})'/g;
		// Regex literals escape slash delimiters; Renovate strings need no delimiters escaped.
		const filePattern = `/${FILE_PATTERN.source.replaceAll('\\/', '/')}/`;
		const matchString = MATCH_STRING.source.replaceAll('\\/', '/');
		const script = readFileSync(join(root, 'scripts/check-workflows.mjs'), 'utf8');
		const managers = config.customManagers.filter((manager) =>
			manager.managerFilePatterns.includes(filePattern),
		);
		assert.equal(managers.length, 1);
		assert.equal(managers[0].matchStrings[0], matchString);
		assert.equal(managers[0].customType, 'regex');
		assert.equal(managers[0].datasourceTemplate, 'docker');
		assert.ok(FILE_PATTERN.test('scripts/check-workflows.mjs'));
		const hits = [...script.matchAll(MATCH_STRING)];
		assert.equal(hits.length, 1);
		assert.equal(
			`${hits[0].groups.depName}:${hits[0].groups.currentValue}@${hits[0].groups.currentDigest}`,
			ACTIONLINT_IMAGE,
		);
	});

	it('P5 wires the unconditional job into CI Gate and local verification', () => {
		const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
		const job = workflow.jobs['workflow-lint'];
		assert.ok(Number.isInteger(job['timeout-minutes']));
		assert.ok(WORST_CASE_MS + 120_000 <= job['timeout-minutes'] * 60_000);
		assert.equal(job['runs-on'], 'ubuntu-26.04');
		assert.ok(!Object.hasOwn(job, 'if'));
		assert.ok(!Object.hasOwn(job, 'continue-on-error'));
		const lintSteps = job.steps.filter((step) => step.run === 'node scripts/check-workflows.mjs');
		assert.equal(lintSteps.length, 1);
		// A step condition or continue-on-error would let the job pass without a lint.
		assert.ok(!Object.hasOwn(lintSteps[0], 'if'));
		assert.ok(!Object.hasOwn(lintSteps[0], 'continue-on-error'));
		assert.ok(workflow.jobs['ci-gate'].needs.includes('workflow-lint'));
		assert.ok(MUST_SUCCEED.includes('workflow-lint'));
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		assert.equal(pkg.scripts['check:workflows'], 'node scripts/check-workflows.mjs');
		const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
		const verifyAll = makefile.split('verify-all:\n')[1].split('\n\n')[0];
		assert.match(verifyAll, /\n\t@pnpm check:renovate-config\n\t@pnpm check:workflows\n/);
	});

	it('P6 keeps every planted error outside GitHub workflow discovery', () => {
		const planted = parse(readFileSync(join(root, PLANTED_FILE), 'utf8'));
		assert.ok(!Object.hasOwn(planted.jobs.stepless, 'steps'));
		assert.ok(planted.jobs.unquoted.steps.some((step) => step.run.includes('$UNQUOTED')));
		assert.deepEqual(planted.jobs.orphan.needs, ['absent']);
		assert.ok(!Object.hasOwn(planted.jobs, 'absent'));
		assert.ok(!PLANTED_FILE.startsWith('.github/workflows/'));
	});

	it('P7 reuses the actionlint image already held by the runtime', () => {
		const { calls, runner } = stubRunner({ 'docker image': OK });
		assert.deepEqual(ensureImage('docker', ACTIONLINT_IMAGE, runner), []);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].args, ['image', 'inspect', '--format', '{{.Id}}', ACTIONLINT_IMAGE]);
	});

	it('P8 passes every workflow file of this repository and its configuration', (t) => {
		t.mock.method(console, 'log', () => {});
		const expected = readdirSync(join(root, '.github/workflows'))
			.filter((name) => /\.ya?ml$/i.test(name))
			.sort()
			.map((name) => `.github/workflows/${name}`);
		assert.ok(expected.length > 1);
		const { calls, runner } = lintRunner();
		assert.equal(main(root, runner, { CI: 'true' }, IDS), 0);
		const repository = calls.filter((call) => call.args[0] === 'run')[1];
		const configAt = repository.args.indexOf('-config-file');
		assert.deepEqual(repository.args.slice(configAt, configAt + 2), CONFIG_ARGS);
		assert.deepEqual(repository.args.slice(configAt + 2), expected);
		const config = parse(readFileSync(join(root, CONFIG_ARGS[1]), 'utf8'));
		assert.ok(config['self-hosted-runner'].labels.includes('ubuntu-26.04'));
	});

	it('P7 pulls the absent actionlint image quietly', () => {
		const { calls, runner } = stubRunner({ 'docker pull': OK });
		assert.deepEqual(ensureImage('docker', ACTIONLINT_IMAGE, runner), []);
		assert.equal(calls.length, 2);
		assert.deepEqual(calls[1].args, ['pull', '--quiet', ACTIONLINT_IMAGE]);
	});
});

describe('workflow lint: negative', () => {
	it('N1 refuses a planted workflow accepted with exit 0', (t) => {
		t.mock.method(console, 'error', () => {});
		const problems = judgeLint('planted', false, OK);
		assert.equal(problems.length, 1);
		assert.ok(problems[0].includes(STEPS_MARKER));
		assert.ok(problems[0].includes(SHELLCHECK_MARKER));
		assert.ok(problems[0].includes(NEEDS_MARKER));
		assert.match(problems[0], /would not catch the regression/);
		assert.equal(main('/src/repo', lintRunner(OK).runner, { CI: 'true' }, IDS, LIST), 1);
	});

	it('N2 fails when the planted run lacks only shellcheck', (t) => {
		t.mock.method(console, 'error', () => {});
		const withoutShellcheck = { ...FAILED, output: `${STEPS_MARKER} "stepless"\n${NEEDS_MARKER}` };
		const problems = judgeLint('planted', false, withoutShellcheck);
		assert.equal(problems.length, 1);
		assert.ok(problems[0].split('\n')[0].includes(SHELLCHECK_MARKER));
		assert.ok(!problems[0].split('\n')[0].includes(STEPS_MARKER));
		assert.ok(!problems[0].split('\n')[0].includes(NEEDS_MARKER));
		assert.equal(main('/src/repo', lintRunner(withoutShellcheck).runner, {}, IDS, LIST), 1);
	});

	it('N2 fails when the planted run lacks only the job-needs finding', (t) => {
		t.mock.method(console, 'error', () => {});
		const withoutNeeds = { ...FAILED, output: `${STEPS_MARKER} "stepless"\n${SHELLCHECK_MARKER}` };
		const problems = judgeLint('planted', false, withoutNeeds);
		assert.equal(problems.length, 1);
		assert.ok(problems[0].split('\n')[0].includes(NEEDS_MARKER));
		assert.ok(!problems[0].split('\n')[0].includes(SHELLCHECK_MARKER));
		assert.equal(main('/src/repo', lintRunner(withoutNeeds).runner, {}, IDS, LIST), 1);
	});

	it('N3 reports workflow problems with their output and fails main', (t) => {
		t.mock.method(console, 'error', () => {});
		const result = { ...FAILED, output: 'ci.yml:9: missing steps' };
		const problems = judgeLint('repository', true, result);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /actionlint reports problems in \.github\/workflows \(exit 1\)/);
		assert.ok(problems[0].endsWith(result.output));
		assert.equal(main('/src/repo', lintRunner(PLANTED_REFUSED, result).runner, {}, IDS, LIST), 1);
	});

	it('N4 fails without a runtime in CI and skips with a reason locally', (t) => {
		const errors = [],
			warnings = [];
		t.mock.method(console, 'error', (message) => errors.push(message));
		t.mock.method(console, 'warn', (message) => warnings.push(message));
		const { calls, runner } = stubRunner({});
		assert.equal(main('/src/repo', runner, { CI: 'true' }, IDS, LIST), 1);
		assert.equal(main('/src/repo', runner, {}, IDS, LIST), 0);
		assert.deepEqual(errors, [
			'FAIL: neither docker nor podman answers, so the pinned actionlint image cannot run',
		]);
		assert.deepEqual(warnings, [
			'SKIP: workflows not linted: neither docker nor podman answers, ' +
				'so the pinned actionlint image cannot run; CI runs it.',
		]);
		assert.deepEqual(
			calls.map((call) => `${call.file} ${call.args[0]}`),
			['docker version', 'podman version', 'docker version', 'podman version'],
		);
	});

	it('N5 stops before linting when pulling the image fails', (t) => {
		const errors = [];
		t.mock.method(console, 'error', (message) => errors.push(message));
		const { calls, runner } = stubRunner({ 'docker version': OK });
		assert.equal(main('/src/repo', runner, { CI: 'true' }, IDS, LIST), 1);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /^FAIL: docker pull .* exited 1\nno such image$/);
		assert.deepEqual(
			calls.map((call) => call.args[0]),
			['version', 'image', 'pull'],
		);
	});

	for (const [label, result, diagnostic] of [
		['timeout', TIMED_OUT, /did not run: spawnSync docker ETIMEDOUT/],
		['signal', { ...OK, status: null, signal: 'SIGKILL' }, /stopped by SIGKILL/],
	]) {
		it(`N6 removes the stopped repository container after ${label}`, (t) => {
			const errors = [];
			t.mock.method(console, 'error', (message) => errors.push(message));
			const { calls, runner } = stubRunner({
				'docker version': OK,
				'docker image': OK,
				'docker run': (args) => (args.at(-1) === PLANTED_FILE ? PLANTED_REFUSED : result),
				'docker rm': OK,
			});
			assert.equal(main('/src/repo', runner, { CI: 'true' }, IDS, LIST), 1);
			assert.equal(errors.length, 1);
			assert.match(errors[0], diagnostic);
			const runs = calls.filter((call) => call.args[0] === 'run');
			assert.equal(runs.length, 2);
			const name = runs[1].args[runs[1].args.indexOf('--name') + 1];
			assert.deepEqual(calls.at(-1), {
				file: 'docker',
				args: ['rm', '--force', name],
				options: { timeout: PROBE_TIMEOUT_MS },
			});
		});
	}

	it('N7 fails before any runtime call, even locally, when no workflow is listed', (t) => {
		const errors = [];
		t.mock.method(console, 'error', (message) => errors.push(message));
		const { calls, runner } = lintRunner();
		assert.equal(
			main('/src/repo', runner, {}, IDS, () => ['README.md', 'ci.yml.bak']),
			1,
		);
		assert.deepEqual(errors, [
			'FAIL: .github/workflows holds no .yml or .yaml file, so nothing would be linted',
		]);
		assert.equal(calls.length, 0);
	});

	it('N8 reports a checkout without .github/workflows instead of linting nothing', (t) => {
		const errors = [];
		t.mock.method(console, 'error', (message) => errors.push(message));
		const empty = mkdtempSync(join(tmpdir(), 'workflow-lint-'));
		try {
			const { calls, runner } = lintRunner();
			assert.equal(main(empty, runner, { CI: 'true' }, IDS), 1);
			assert.equal(errors.length, 1);
			assert.match(errors[0], /^FAIL: cannot list \.github\/workflows: ENOENT/);
			assert.equal(calls.length, 0);
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});

describe('workflow lint: boundary', () => {
	for (const status of [2, 3]) {
		it(`B1 distinguishes repository exit ${status} from lint findings`, () => {
			const problems = judgeLint('repository', true, { ...FAILED, status });
			assert.equal(problems.length, 1);
			assert.ok(problems[0].includes(`actionlint failed (exit ${status})`));
			assert.ok(problems[0].includes('so .github/workflows was not checked'));
			assert.ok(!problems[0].includes('reports problems'));
		});

		it(`B2 rejects planted exit ${status} even with every diagnostic`, () => {
			const problems = judgeLint('planted', false, { ...PLANTED_REFUSED, status });
			assert.equal(problems.length, 1);
			const heading = problems[0].split('\n')[0];
			assert.match(heading, /the planted workflow was not refused/);
			assert.ok(heading.includes(`(exit ${status})`));
			assert.ok(heading.includes(STEPS_MARKER));
			assert.ok(heading.includes(SHELLCHECK_MARKER));
		});
	}

	it('B3 keeps exactly the last EXCERPT_LINES of 41 planted output lines', () => {
		const lines = Array.from({ length: 41 }, (_, index) => `line ${index}`);
		const problems = judgeLint('planted', false, { ...OK, output: `${lines.join('\n')}\n` });
		assert.equal(problems.length, 1);
		const kept = problems[0].split('\n').slice(1);
		assert.equal(kept.length, EXCERPT_LINES);
		assert.deepEqual(kept, lines.slice(1));
	});

	it('B5 lists exactly MAX_WORKFLOWS entries and refuses one more', () => {
		assert.equal(MAX_WORKFLOWS, 256);
		const names = (count) => Array.from({ length: count }, (_, index) => `w${index}.yml`);
		const atLimit = workflowFiles('/src/repo', () => names(256));
		assert.deepEqual(atLimit.problems, []);
		assert.equal(atLimit.files.length, 256);
		assert.deepEqual(
			workflowFiles('/src/repo', () => names(257)),
			{
				problems: ['.github/workflows holds 257 entries, more than MAX_WORKFLOWS (256)'],
			},
		);
	});

	it('B6 keeps .yml and .yaml names in any case, sorted, and nothing else', () => {
		const listed = workflowFiles('/src/repo', () => [
			'z.yaml',
			'README.md',
			'a.yml',
			'b.yml.bak',
			'c.YML',
			'yml',
			'm.Yaml',
		]);
		assert.deepEqual(listed, {
			problems: [],
			files: [
				'.github/workflows/a.yml',
				'.github/workflows/c.YML',
				'.github/workflows/m.Yaml',
				'.github/workflows/z.yaml',
			],
		});
	});

	it('B4 preserves the Renovate ensureImage wrapper image and signature', () => {
		const { calls, runner } = stubRunner({ 'docker image': OK });
		assert.deepEqual(ensureRenovateImage('docker', runner), []);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].args, ['image', 'inspect', '--format', '{{.Id}}', RENOVATE_IMAGE]);
	});
});
