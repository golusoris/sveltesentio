import type { ProblemError } from '@sveltesentio/core';

/**
 * The in-flight request bookkeeping the IPC client does.
 *
 * Requests go out in order and responses come back in order, so a FIFO is the
 * whole protocol state. `createIpcClient` held this inline — the array, the
 * per-request timeout handle, the "remove me if the write failed" splice written
 * twice, and a `failAll` that had to remember to clear each timer — which made
 * the factory 98 lines and made none of it reachable from a test without
 * building a socket.
 *
 * Every exit path clears the timer, which is the part that was easy to get wrong
 * when it was spread across the factory: a settled request whose timer still
 * fires would reject a promise that already resolved.
 */
export interface PendingQueue {
	/** The error that killed the connection, once one has. */
	readonly failure: ProblemError | undefined;
	/** Number of requests awaiting a response. */
	readonly size: number;
	/**
	 * Registers a request and arms its timeout when one is configured.
	 *
	 * `onTimeout` fires after `timeoutMs`, having already removed the entry, so
	 * the caller only has to reject.
	 */
	add(entry: PendingEntry, timeoutMs: number | undefined, onTimeout: () => void): PendingHandle;
	/** Hands the next response to the oldest waiter. Extra frames are dropped. */
	settleNext(payload: Uint8Array): void;
	/** Rejects every waiter and records `error` as the terminal failure. */
	failAll(error: ProblemError): void;
}

export interface PendingEntry {
	resolve(payload: Uint8Array): void;
	reject(error: ProblemError): void;
}

/** A registered request, which the caller can withdraw if its write failed. */
export interface PendingHandle {
	/** Removes the entry and clears its timer. Safe to call twice. */
	cancel(): void;
}

interface Registered extends PendingEntry {
	timer: ReturnType<typeof setTimeout> | undefined;
}

/** Creates an empty queue. */
export function createPendingQueue(): PendingQueue {
	const queue: Registered[] = [];
	let failure: ProblemError | undefined;

	const drop = (entry: Registered): boolean => {
		const index = queue.indexOf(entry);
		if (index < 0) return false;
		queue.splice(index, 1);
		if (entry.timer !== undefined) clearTimeout(entry.timer);
		entry.timer = undefined;
		return true;
	};

	return {
		get failure(): ProblemError | undefined {
			return failure;
		},
		get size(): number {
			return queue.length;
		},
		add(entry: PendingEntry, timeoutMs: number | undefined, onTimeout: () => void): PendingHandle {
			const registered: Registered = { ...entry, timer: undefined };
			if (timeoutMs !== undefined) {
				registered.timer = setTimeout(() => {
					registered.timer = undefined;
					if (drop(registered)) onTimeout();
				}, timeoutMs);
			}
			queue.push(registered);
			return {
				cancel(): void {
					drop(registered);
				},
			};
		},
		settleNext(payload: Uint8Array): void {
			const next = queue.shift();
			if (!next) return;
			if (next.timer !== undefined) clearTimeout(next.timer);
			next.resolve(payload);
		},
		failAll(error: ProblemError): void {
			failure = error;
			// Bounded by the queue's own length, which only shrinks here.
			while (queue.length > 0) {
				const next = queue.shift();
				if (!next) continue;
				if (next.timer !== undefined) clearTimeout(next.timer);
				next.reject(error);
			}
		},
	};
}
