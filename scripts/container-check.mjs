// Shared container process deadlines, runtime discovery, mounts, image pulls and cleanup.
// Used by check-renovate-config.mjs and check-workflows.mjs; imports start no processes.
import { spawnSync } from 'node:child_process';

export const RUNTIMES = Object.freeze(['docker', 'podman']);

// Deadlines on every child process, and bounds on what one run keeps (HISS-02).
export const PROBE_TIMEOUT_MS = 20_000,
	PULL_TIMEOUT_MS = 600_000,
	OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024,
	EXCERPT_LINES = 40;

/** Runs one child process with a deadline; output is stdout and stderr joined. */
export function run(file, args, { timeout }) {
	const result = spawnSync(file, args, {
		env: { ...process.env, NO_COLOR: '1' },
		timeout,
		// SIGTERM can be ignored; the deadline must bound the child (HISS-02).
		killSignal: 'SIGKILL',
		encoding: 'utf8',
		maxBuffer: OUTPUT_LIMIT_BYTES,
		windowsHide: true,
	});
	return {
		status: result.status,
		signal: result.signal,
		error: result.error,
		output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
	};
}

/** The last lines of a run's output, enough to read the validator's verdict. */
export function excerpt(output) {
	return output.trimEnd().split('\n').slice(-EXCERPT_LINES).join('\n');
}

/** Why a child process did not finish on its own, or null when it did. */
export function stopProblem(label, result) {
	if (result.error) return `${label} did not run: ${result.error.message}`;
	if (result.signal) return `${label} was stopped by ${result.signal} before it finished`;
	return null;
}

/** The first container runtime whose engine answers, or null when none does. */
export function findRuntime(runner = run) {
	for (const runtime of RUNTIMES) {
		// Server requires the engine to answer, rather than only the runtime client.
		const result = runner(runtime, ['version', '--format', '{{.Server.Version}}'], {
			timeout: PROBE_TIMEOUT_MS,
		});
		if (stopProblem(runtime, result) === null && result.status === 0) return runtime;
	}
	return null;
}

/**
 * The `--mount` value binding the repository read-only at /repo. The value is
 * comma-separated, so a source path holding a comma or quote is quoted the
 * way that format reads it.
 */
export function mountArgument(rootDir) {
	const source = /[",]/.test(rootDir)
		? `"source=${rootDir.replaceAll('"', '""')}"`
		: `source=${rootDir}`;
	return `type=bind,${source},target=/repo,readonly`;
}

/** Pulls the pinned image unless the runtime already holds it. */
export function ensureImage(runtime, image, runner = run) {
	const inspect = runner(runtime, ['image', 'inspect', '--format', '{{.Id}}', image], {
		timeout: PROBE_TIMEOUT_MS,
	});
	if (stopProblem('inspect', inspect) === null && inspect.status === 0) return [];
	const label = `${runtime} pull ${image}`;
	const pull = runner(runtime, ['pull', '--quiet', image], { timeout: PULL_TIMEOUT_MS });
	const stopped = stopProblem(label, pull);
	if (stopped) return [stopped];
	if (pull.status !== 0) return [`${label} exited ${pull.status}\n${excerpt(pull.output)}`];
	return [];
}

/**
 * Answers from `rm --force` meaning the container is gone or `--rm` is already removing it:
 * Docker "No such container: x", Podman "x: no such container", and Docker
 * "removal of container x is already in progress" when the container exited at the deadline.
 */
const CONTAINER_GONE = /no such container|removal of container .* is already in progress/i;

/**
 * Removes a stopped validator's container, which can outlive its runtime client.
 * A deadline that strikes before the runtime has created the container can still leave it in
 * the Created state, with no process running; that needs a create slower than VALIDATE_TIMEOUT_MS.
 */
export function removeStopped(runtime, name, file, result, runner = run) {
	if (stopProblem(file, result) === null) return [];
	const removal = runner(runtime, ['rm', '--force', name], { timeout: PROBE_TIMEOUT_MS });
	const stopped = stopProblem(`${runtime} rm --force ${name}`, removal);
	if ((stopped === null && removal.status === 0) || CONTAINER_GONE.test(removal.output)) {
		return [];
	}
	const reason = stopped ?? `exit ${removal.status}\n${excerpt(removal.output)}`;
	return [`could not remove container ${name} after ${file} stopped: ${reason}`];
}

/** Current numeric user and group IDs, or null on platforms without them. */
export function currentIds() {
	if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return null;
	return { uid: process.getuid(), gid: process.getgid() };
}

/** Runtime arguments allowing the container to read an owner-only checkout. */
export function userArgs(runtime, ids = currentIds()) {
	if (ids === null) return [];
	return runtime === 'docker' ? ['--user', `${ids.uid}:${ids.gid}`] : ['--userns=keep-id'];
}
