import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	ACCEPTED_MESSAGE,
	CONFIG_FILE,
	EXCERPT_LINES,
	PLANTED_FILE,
	PLANTED_MESSAGE,
	PROBE_TIMEOUT_MS,
	RE2_FALLBACK_MESSAGE,
	RENOVATE_IMAGE,
	ensureImage,
	excerpt,
	findRuntime,
	judgeValidation,
	main,
	mountArgument,
	removeStopped,
	run,
	stopProblem,
	validatorArgs,
} from './check-renovate-config.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const OK = { status: 0, signal: null, error: undefined, output: '' };
const FAILED = { status: 1, signal: null, error: undefined, output: 'no such image' };
const ACCEPTED = { ...OK, output: `${ACCEPTED_MESSAGE} against 1 file(s)` };
const PLANTED_REFUSED = {
	...FAILED,
	output: `"message": "${PLANTED_MESSAGE}: matchUpdateTypes had invalid values"`,
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

const byFile = (args) => (args.at(-1) === CONFIG_FILE ? ACCEPTED : PLANTED_REFUSED);

describe('run', () => {
	it('bounds a child that ignores SIGTERM with SIGKILL', () => {
		const started = process.hrtime.bigint();
		const result = run(
			process.execPath,
			[
				'-e',
				'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 5000);',
			],
			{ timeout: 500 },
		);
		const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
		assert.ok(elapsed < 3000, `child took ${elapsed} ms despite a 500 ms deadline`);
		assert.equal(result.signal, 'SIGKILL');
		assert.equal(result.error?.code, 'ETIMEDOUT');
	});
});

describe('the pinned image', () => {
	it('names a release tag and a sha256 digest', () => {
		assert.match(
			RENOVATE_IMAGE,
			/^ghcr\.io\/renovatebot\/renovate:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
		);
	});

	it('is matched by exactly one renovate.json customManagers entry', () => {
		const config = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
		const script = readFileSync(join(root, 'scripts/check-renovate-config.mjs'), 'utf8');
		const managers = config.customManagers.filter((manager) =>
			manager.managerFilePatterns.some((pattern) =>
				new RegExp(pattern.slice(1, -1)).test('scripts/check-renovate-config.mjs'),
			),
		);
		assert.equal(managers.length, 1);
		const hits = [...script.matchAll(new RegExp(managers[0].matchStrings[0], 'g'))];
		assert.equal(hits.length, 1);
		assert.equal(
			`${hits[0].groups.depName}:${hits[0].groups.currentValue}@${hits[0].groups.currentDigest}`,
			RENOVATE_IMAGE,
		);
	});

	it('names a planted file that holds the refused update type', () => {
		const planted = JSON.parse(readFileSync(join(root, PLANTED_FILE), 'utf8'));
		assert.deepEqual(planted.packageRules[0].matchUpdateTypes, ['vulnerability']);
	});
});

describe('excerpt', () => {
	it('keeps a short output whole', () => {
		assert.equal(excerpt('a\nb\n'), 'a\nb');
	});

	it('keeps exactly the last EXCERPT_LINES lines of a long output', () => {
		const lines = Array.from({ length: EXCERPT_LINES + 5 }, (_, index) => `line ${index}`);
		const kept = excerpt(lines.join('\n')).split('\n');
		assert.equal(kept.length, EXCERPT_LINES);
		assert.equal(kept[0], 'line 5');
		assert.equal(kept.at(-1), `line ${EXCERPT_LINES + 4}`);
	});
});

describe('stopProblem', () => {
	it('is null for a process that exited on its own', () => {
		assert.equal(stopProblem('x', FAILED), null);
	});

	it('names a spawn error and a signal', () => {
		assert.match(
			stopProblem('x', { error: new Error('spawn docker ENOENT') }),
			/did not run: spawn docker ENOENT/,
		);
		assert.match(stopProblem('x', { status: null, signal: 'SIGTERM' }), /stopped by SIGTERM/);
	});
});

describe('findRuntime', () => {
	it('takes Docker when its engine answers', () => {
		const { calls, runner } = stubRunner({ 'docker version': OK });
		assert.equal(findRuntime(runner), 'docker');
		assert.equal(calls.length, 1);
		assert.ok(calls[0].options.timeout > 0);
	});

	it('falls through to Podman when Docker does not answer', () => {
		const { runner } = stubRunner({
			'docker version': { error: new Error('spawn docker ENOENT') },
			'podman version': OK,
		});
		assert.equal(findRuntime(runner), 'podman');
	});

	it('is null when neither answers', () => {
		assert.equal(findRuntime(stubRunner({}).runner), null);
	});
});

describe('mountArgument', () => {
	it('binds a plain path read-only at /repo', () => {
		assert.equal(mountArgument('/src/repo'), 'type=bind,source=/src/repo,target=/repo,readonly');
	});

	it('quotes a path holding a comma or a quote', () => {
		assert.equal(mountArgument('/a,b'), 'type=bind,"source=/a,b",target=/repo,readonly');
		assert.equal(mountArgument('/a"b'), 'type=bind,"source=/a""b",target=/repo,readonly');
	});
});

describe('validatorArgs', () => {
	it('runs the pinned image offline and read-only on one file', () => {
		const args = validatorArgs('/src/repo', CONFIG_FILE, 'validator-test');
		assert.equal(args[0], 'run');
		assert.deepEqual(args.slice(args.indexOf('--network'), args.indexOf('--network') + 2), [
			'--network',
			'none',
		]);
		assert.ok(args.includes('--read-only'));
		assert.equal(args[args.indexOf('--entrypoint') + 1], 'renovate-config-validator');
		assert.deepEqual(args.slice(-4), [RENOVATE_IMAGE, '--strict', '--no-global', CONFIG_FILE]);
	});

	it('puts the supplied container name before the image', () => {
		const args = validatorArgs('/src/repo', CONFIG_FILE, 'validator-test');
		const index = args.indexOf('--name');
		assert.ok(index > 0);
		assert.equal(args[index + 1], 'validator-test');
		assert.ok(index + 1 < args.indexOf(RENOVATE_IMAGE));
	});
});

describe('ensureImage', () => {
	it('does not pull an image the runtime holds', () => {
		const { calls, runner } = stubRunner({ 'docker image': OK });
		assert.deepEqual(ensureImage('docker', runner), []);
		assert.equal(calls.length, 1);
	});

	it('pulls an absent image', () => {
		const { calls, runner } = stubRunner({ 'docker pull': OK });
		assert.deepEqual(ensureImage('docker', runner), []);
		assert.deepEqual(calls[1].args, ['pull', '--quiet', RENOVATE_IMAGE]);
	});

	it('reports a failed pull', () => {
		const problems = ensureImage('podman', stubRunner({}).runner);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /^podman pull ghcr\.io\/renovatebot\/renovate:.* exited 1/);
	});

	it('pulls when inspecting the image timed out', () => {
		const { calls, runner } = stubRunner({ 'docker image': TIMED_OUT, 'docker pull': OK });
		assert.deepEqual(ensureImage('docker', runner), []);
		assert.equal(calls.length, 2);
		assert.deepEqual(calls[1].args, ['pull', '--quiet', RENOVATE_IMAGE]);
	});

	it('reports a pull stopped by a signal', () => {
		const { runner } = stubRunner({ 'podman pull': { ...OK, status: null, signal: 'SIGKILL' } });
		const problems = ensureImage('podman', runner);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /^podman pull .* was stopped by SIGKILL before it finished$/);
	});
});

describe('judgeValidation', () => {
	it('passes an accepted configuration', () => {
		assert.deepEqual(judgeValidation(CONFIG_FILE, true, ACCEPTED), []);
	});

	it('fails a configuration Renovate refuses', () => {
		const problems = judgeValidation(CONFIG_FILE, true, PLANTED_REFUSED);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /Renovate refuses this configuration \(exit 1\)/);
	});

	it('fails exit 0 without the success line', () => {
		assert.equal(judgeValidation(CONFIG_FILE, true, OK).length, 1);
	});

	it('passes the planted rule when it is refused for the planted reason', () => {
		assert.deepEqual(judgeValidation(PLANTED_FILE, false, PLANTED_REFUSED), []);
	});

	it('fails the planted rule when the validator accepts it', () => {
		const problems = judgeValidation(PLANTED_FILE, false, ACCEPTED);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /would not catch the regression/);
	});

	it('fails the planted rule when it is refused for another reason', () => {
		assert.equal(judgeValidation(PLANTED_FILE, false, FAILED).length, 1);
	});

	it('fails closed when the validator fell back from RE2', () => {
		const fallback = {
			...ACCEPTED,
			output: `${RE2_FALLBACK_MESSAGE}, falling back to RegExp\n${ACCEPTED.output}`,
		};
		const problems = judgeValidation(CONFIG_FILE, true, fallback);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /ran without RE2/);
	});

	it('fails a validator stopped by its deadline', () => {
		const problems = judgeValidation(CONFIG_FILE, true, {
			status: null,
			signal: 'SIGTERM',
			output: '',
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /stopped by SIGTERM/);
	});
});

describe('main', () => {
	it('returns 0 when the config validates and the planted rule is refused', () => {
		const { calls, runner } = stubRunner({
			'docker version': OK,
			'docker image': OK,
			'docker run': byFile,
		});
		assert.equal(main('/src/repo', runner, {}), 0);
		const validated = calls
			.filter((call) => call.args[0] === 'run')
			.map((call) => call.args.at(-1));
		assert.deepEqual(validated, [CONFIG_FILE, PLANTED_FILE]);
		assert.equal(calls.filter((call) => call.args[0] === 'rm').length, 0);
		const names = calls
			.filter((call) => call.args[0] === 'run')
			.map((call) => call.args[call.args.indexOf('--name') + 1]);
		assert.equal(new Set(names).size, 2);
		for (const name of names) {
			assert.match(name, new RegExp(`^renovate-config-check-${process.pid}-[0-9a-f]{8}$`));
		}
	});

	it('returns 1 when the validator accepts the planted rule', () => {
		const { runner } = stubRunner({
			'docker version': OK,
			'docker image': OK,
			'docker run': ACCEPTED,
		});
		assert.equal(main('/src/repo', runner, {}), 1);
	});

	it('returns 1 when renovate.json is refused', () => {
		const { runner } = stubRunner({
			'docker version': OK,
			'docker image': OK,
			'docker run': PLANTED_REFUSED,
		});
		assert.equal(main('/src/repo', runner, {}), 1);
	});

	it('skips with a reason outside CI when no runtime answers', () => {
		assert.equal(main('/src/repo', stubRunner({}).runner, {}), 0);
	});

	it('fails in CI when no runtime answers', () => {
		assert.equal(main('/src/repo', stubRunner({}).runner, { CI: 'true' }), 1);
	});
});

describe('removeStopped', () => {
	it('leaves normally exited validators to --rm, including nonzero exits', () => {
		const { calls, runner } = stubRunner({});
		for (const result of [OK, FAILED]) {
			assert.deepEqual(removeStopped('docker', 'validator-test', CONFIG_FILE, result, runner), []);
		}
		assert.equal(calls.length, 0);
	});

	for (const [label, result] of [
		['timeout', TIMED_OUT],
		['signal', { ...OK, status: null, signal: 'SIGTERM' }],
		['spawn error', { ...OK, status: null, error: new Error('spawn docker ENOENT') }],
		['ENOBUFS', { ...OK, status: null, error: new Error('spawnSync docker ENOBUFS') }],
	]) {
		it(`removes a validator after ${label}`, () => {
			const { calls, runner } = stubRunner({ 'podman rm': OK });
			assert.deepEqual(removeStopped('podman', 'validator-test', CONFIG_FILE, result, runner), []);
			assert.deepEqual(calls, [
				{
					file: 'podman',
					args: ['rm', '--force', 'validator-test'],
					options: { timeout: PROBE_TIMEOUT_MS },
				},
			]);
		});
	}

	for (const [label, removal, expected] of [
		['timeout', TIMED_OUT, /did not run: spawnSync docker ETIMEDOUT/],
		['signal', { ...OK, status: null, signal: 'SIGKILL' }, /stopped by SIGKILL/],
		[
			'spawn error',
			{ ...OK, error: new Error('spawn docker ENOENT') },
			/did not run: spawn docker ENOENT/,
		],
	]) {
		it(`reports removal ${label} with container and file context`, () => {
			const { runner } = stubRunner({ 'docker rm': removal });
			const problems = removeStopped('docker', 'validator-test', CONFIG_FILE, TIMED_OUT, runner);
			assert.equal(problems.length, 1);
			const prefix = `could not remove container validator-test after ${CONFIG_FILE} stopped: `;
			assert.ok(problems[0].startsWith(prefix));
			assert.match(problems[0], expected);
		});
	}
});

describe('main stopped validator cleanup', () => {
	for (const [label, removal, extraProblem] of [
		['successful removal', OK, false],
		['Docker missing container', { ...FAILED, output: 'No such container: validator-test' }, false],
		['Podman missing container', { ...FAILED, output: 'validator-test: no such container' }, false],
		[
			'Docker removal already in progress',
			{
				...FAILED,
				output:
					'Error response from daemon: removal of container validator-test is already in progress',
			},
			false,
		],
		['failed removal', { ...FAILED, output: 'removal denied' }, true],
	]) {
		it(`removes the timed-out container immediately: ${label}`, (t) => {
			const errors = [];
			t.mock.method(console, 'error', (message) => errors.push(message));
			const { calls, runner } = stubRunner({
				'docker version': OK,
				'docker image': OK,
				'docker run': (args) => (args.at(-1) === CONFIG_FILE ? TIMED_OUT : PLANTED_REFUSED),
				'docker rm': removal,
			});
			assert.equal(main('/src/repo', runner, {}), 1);
			const index = calls.findIndex((call) => call.args[0] === 'run');
			const name = calls[index].args[calls[index].args.indexOf('--name') + 1];
			assert.match(name, new RegExp(`^renovate-config-check-${process.pid}-[0-9a-f]{8}$`));
			assert.deepEqual(calls[index + 1], {
				file: 'docker',
				args: ['rm', '--force', name],
				options: { timeout: PROBE_TIMEOUT_MS },
			});
			assert.equal(calls.filter((call) => call.args[0] === 'rm').length, 1);
			assert.equal(errors.length, extraProblem ? 2 : 1);
			assert.match(errors[0], /ETIMEDOUT/);
			if (extraProblem) {
				assert.equal(
					errors[1],
					`FAIL: could not remove container ${name} after ${CONFIG_FILE} stopped: exit 1\nremoval denied`,
				);
			}
		});
	}
});

describe('validation failure boundaries', () => {
	it('fails nonzero exit even with the success line', () => {
		assert.equal(judgeValidation(CONFIG_FILE, true, { ...ACCEPTED, status: 1 }).length, 1);
	});

	it('fails a spawn error even with the planted diagnostic', () => {
		const problems = judgeValidation(PLANTED_FILE, false, {
			...PLANTED_REFUSED,
			error: new Error('spawnSync docker ENOBUFS'),
		});
		assert.equal(problems.length, 1);
		assert.match(problems[0], /did not run: spawnSync docker ENOBUFS/);
	});

	it('returns 1 without running a validator when the image step fails', () => {
		const { calls, runner } = stubRunner({
			'docker version': OK,
			'docker pull': { ...OK, status: null, signal: 'SIGKILL' },
		});
		assert.equal(main('/src/repo', runner, {}), 1);
		assert.deepEqual(
			calls.map((call) => call.args[0]),
			['version', 'image', 'pull'],
		);
	});
});
