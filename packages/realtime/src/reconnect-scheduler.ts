import { computeBackoff, type BackoffOptions } from './backoff.js';

/**
 * The retry-with-backoff bookkeeping both transports do.
 *
 * `SseClient` and `createConnectStream` each carried an attempt counter, a
 * pending-timer handle, a `scheduleReconnect` that incremented the counter and
 * armed `computeBackoff`, and a `clearReconnect` that was byte-identical between
 * them apart from `this.`. One is a class and the other a closure factory, which
 * is why the duplication survived review — the shapes differ, the behaviour does
 * not (HISS-19).
 *
 * Extracting it also brings `createConnectStream` under the 60-line function cap
 * (HISS-04), which it exceeded by holding this inline.
 */
export interface ReconnectScheduler {
	/** Retries since the last {@link reset}; 0 before the first failure. */
	readonly attempt: number;
	/** Forget the retry history, so the next delay starts from the floor. */
	reset(): void;
	/**
	 * Arm the next retry and return the delay chosen for it.
	 *
	 * The attempt counter increments first, so the first retry uses attempt 1
	 * rather than 0 — a backoff of zero would defeat the point.
	 */
	schedule(run: () => void): number;
	/** Cancel a pending retry. Safe when none is armed. */
	clear(): void;
}

export interface ReconnectSchedulerOptions {
	backoff?: BackoffOptions | undefined;
	/** Injected for tests; defaults to the ambient timer functions. */
	setTimeoutImpl?: typeof setTimeout | undefined;
	clearTimeoutImpl?: typeof clearTimeout | undefined;
}

/** Creates a scheduler whose delays come from {@link computeBackoff}. */
export function createReconnectScheduler(
	options: ReconnectSchedulerOptions = {},
): ReconnectScheduler {
	const setTimer = options.setTimeoutImpl ?? setTimeout;
	const clearTimer = options.clearTimeoutImpl ?? clearTimeout;

	let attempt = 0;
	let handle: ReturnType<typeof setTimeout> | undefined;

	return {
		get attempt(): number {
			return attempt;
		},
		reset(): void {
			attempt = 0;
		},
		schedule(run: () => void): number {
			attempt += 1;
			const delay = computeBackoff(attempt, options.backoff);
			handle = setTimer(() => {
				handle = undefined;
				run();
			}, delay);
			return delay;
		},
		clear(): void {
			if (handle !== undefined) {
				clearTimer(handle);
				handle = undefined;
			}
		},
	};
}
