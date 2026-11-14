// Guards per-request clock isolation across interleaved awaits in a long-lived
// server process (gap audit C14-11). The existing suites in clock.test.ts,
// clock-store.test.ts, clock.context.test.ts, and clock.browser.test.ts still
// pass when clock-store.node.ts is replaced with a single module-level variable
// set before `fn` and restored in `finally`, because none of them suspends
// concurrent requests across awaits. `clock.ts` and `clock-store*.ts` register
// no timers (`setInterval`, `setTimeout`, or `setImmediate`), so timer-leak soak
// testing does not apply.
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { getClock, systemClock, withClock } from '../src/clock';
import type { Clock } from '../src/clock';
import { freshClock } from './clock-fixtures';

const REQUESTS = 256;
const CHECKPOINTS = 8;
const MAX_YIELD_TURNS = 5;
const NESTED_CHECKPOINTS = 4;
const BASE_MS = Date.UTC(2026, 3, 17, 12, 0, 0);
const STEP_SECOND_MS = 1_000;

type Handle = ReturnType<typeof withClock>;
type HandleEvent = Parameters<Handle>[0]['event'];
type Resolve = () => Promise<Response>;

interface ClockLocals {
	clock?: Clock;
}

interface CheckpointSample {
	sameIdentity: boolean;
	timeMs: number;
}

interface RequestRun {
	index: number;
	ownClock: Clock;
	expectedMs: number;
	locals: ClockLocals;
	records: CheckpointSample[];
}

interface Gate {
	promise: Promise<void>;
	open: () => void;
}

function distinctClock(i: number): Clock {
	return freshClock(new Date(BASE_MS + i * STEP_SECOND_MS));
}

async function yieldTurns(n: number): Promise<void> {
	for (let turn = 0; turn < MAX_YIELD_TURNS; turn += 1) {
		if (turn >= n) break;
		if (turn % 2 === 0) {
			await setImmediate();
		} else {
			await Promise.resolve();
		}
	}
}

function createGate(): Gate {
	let open: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

async function invokeWithClock(clock: Clock, resolve: Resolve): Promise<ClockLocals> {
	const handle = withClock(clock);
	const locals: ClockLocals = {};
	const event = { locals } as unknown as HandleEvent;
	await handle({ event, resolve });
	return locals;
}

async function sampleCheckpoints(
	ownClock: Clock,
	turns: number,
	count = CHECKPOINTS,
): Promise<CheckpointSample[]> {
	const records: CheckpointSample[] = [];
	for (let checkpoint = 0; checkpoint < CHECKPOINTS; checkpoint += 1) {
		if (checkpoint >= count) break;
		if (checkpoint > 0) {
			await yieldTurns(turns);
		}
		const active = getClock();
		records.push({
			sameIdentity: active === ownClock,
			timeMs: active.now().getTime(),
		});
	}
	return records;
}

// A rejecting request never returns its samples, so `sink` keeps every request's
// samples by index for the caller to check after the rejection.
async function runSoakRequest(
	index: number,
	failure?: Error,
	sink?: Map<number, CheckpointSample[]>,
): Promise<RequestRun> {
	const ownClock = distinctClock(index);
	const expectedMs = ownClock.now().getTime();
	const turns = (index % MAX_YIELD_TURNS) + 1;
	let records: CheckpointSample[] = [];
	const locals = await invokeWithClock(ownClock, async () => {
		records = await sampleCheckpoints(ownClock, turns);
		sink?.set(index, records);
		if (failure !== undefined) {
			throw failure;
		}
		return new Response('ok');
	});
	return { index, ownClock, expectedMs, locals, records };
}

function assertCleanRecords(records: CheckpointSample[] | undefined, expectedMs: number): void {
	expect(records).toHaveLength(CHECKPOINTS);
	for (let c = 0; c < CHECKPOINTS; c += 1) {
		expect(records?.[c]).toEqual({ sameIdentity: true, timeMs: expectedMs });
	}
}

function assertCleanRun(run: RequestRun | undefined, expectedIndex: number): void {
	expect(run).toBeDefined();
	if (run === undefined) return;
	expect(run.index).toBe(expectedIndex);
	expect(run.locals.clock).toBe(run.ownClock);
	assertCleanRecords(run.records, run.expectedMs);
}

function assertSettledOutcome(
	outcome: PromiseSettledResult<RequestRun> | undefined,
	index: number,
	expectedError: Error | undefined,
	samples: Map<number, CheckpointSample[]>,
): void {
	expect(outcome).toBeDefined();
	if (outcome === undefined) return;
	if (expectedError !== undefined) {
		expect(outcome.status).toBe('rejected');
		if (outcome.status === 'rejected') {
			const reason: unknown = outcome.reason;
			expect(reason).toBe(expectedError);
		}
		// The request saw its own clock at every checkpoint before it threw.
		assertCleanRecords(samples.get(index), BASE_MS + index * STEP_SECOND_MS);
		return;
	}
	expect(outcome.status).toBe('fulfilled');
	if (outcome.status === 'fulfilled') {
		assertCleanRun(outcome.value, index);
	}
}

describe('withClock soak — concurrent server requests (positive)', () => {
	it('isolates each request clock across interleaved awaits (positive)', async () => {
		const tasks: Promise<RequestRun>[] = [];
		for (let i = 0; i < REQUESTS; i += 1) {
			tasks.push(runSoakRequest(i));
		}
		const runs = await Promise.all(tasks);
		expect(runs).toHaveLength(REQUESTS);
		for (let i = 0; i < REQUESTS; i += 1) {
			assertCleanRun(runs[i], i);
		}
	});

	it('restores systemClock after all concurrent requests settle (positive)', async () => {
		const tasks: Promise<RequestRun>[] = [];
		for (let i = 0; i < REQUESTS; i += 1) {
			tasks.push(runSoakRequest(i));
		}
		await Promise.all(tasks);
		expect(getClock()).toBe(systemClock);
	});
});

describe('withClock soak — rejecting concurrent requests (negative)', () => {
	it('isolates rejecting requests and their fulfilled siblings when half reject (negative)', async () => {
		const errors = new Map<number, Error>();
		const samples = new Map<number, CheckpointSample[]>();
		const tasks: Promise<RequestRun>[] = [];
		for (let i = 0; i < REQUESTS; i += 1) {
			if (i % 2 === 1) {
				const err = new Error(`soak-reject-${i}`);
				errors.set(i, err);
				tasks.push(runSoakRequest(i, err, samples));
			} else {
				tasks.push(runSoakRequest(i, undefined, samples));
			}
		}
		const settled = await Promise.allSettled(tasks);
		expect(settled).toHaveLength(REQUESTS);
		expect(samples.size).toBe(REQUESTS);
		for (let i = 0; i < REQUESTS; i += 1) {
			assertSettledOutcome(settled[i], i, errors.get(i), samples);
		}
		expect(getClock()).toBe(systemClock);
	});
});

describe('withClock soak — minimal gate interleave (boundary)', () => {
	it('keeps request A clock across a gate while request B runs (boundary)', async () => {
		const clockA = distinctClock(1);
		const clockB = distinctClock(2);
		const gate = createGate();
		let observedABefore: Clock | undefined;
		let observedAAfter: Clock | undefined;
		let observedB: Clock | undefined;

		const pendingA = invokeWithClock(clockA, async () => {
			observedABefore = getClock();
			await gate.promise;
			observedAAfter = getClock();
			return new Response('a');
		});

		const localsB = await invokeWithClock(clockB, () => {
			observedB = getClock();
			return Promise.resolve(new Response('b'));
		});

		expect(localsB.clock).toBe(clockB);
		expect(observedB).toBe(clockB);

		gate.open();
		const localsA = await pendingA;

		expect(localsA.clock).toBe(clockA);
		expect(observedABefore).toBe(clockA);
		expect(observedAAfter).toBe(clockA);
		expect(observedAAfter).not.toBe(clockB);
		expect(observedAAfter).not.toBe(systemClock);
		expect(observedAAfter?.now().getTime()).toBe(clockA.now().getTime());
		expect(getClock()).toBe(systemClock);
	});
});

describe('withClock soak — nested handle across awaits (boundary)', () => {
	it('restores outer clock after nested withClock awaits settle (boundary)', async () => {
		const outerClock = distinctClock(10);
		const innerClock = distinctClock(20);
		let innerSamples: CheckpointSample[] = [];
		let outerBeforeNested: Clock | undefined;
		let outerAfterNestedAwait: Clock | undefined;

		const outerLocals = await invokeWithClock(outerClock, async () => {
			await yieldTurns(2);
			outerBeforeNested = getClock();
			const innerLocals = await invokeWithClock(innerClock, async () => {
				innerSamples = await sampleCheckpoints(innerClock, 2, NESTED_CHECKPOINTS);
				return new Response('inner');
			});
			expect(innerLocals.clock).toBe(innerClock);
			await yieldTurns(2);
			outerAfterNestedAwait = getClock();
			return new Response('outer');
		});

		expect(outerLocals.clock).toBe(outerClock);
		expect(outerBeforeNested).toBe(outerClock);
		expect(innerSamples).toHaveLength(NESTED_CHECKPOINTS);
		for (let i = 0; i < NESTED_CHECKPOINTS; i += 1) {
			expect(innerSamples[i]).toEqual({
				sameIdentity: true,
				timeMs: innerClock.now().getTime(),
			});
		}
		expect(outerAfterNestedAwait).toBe(outerClock);
		expect(outerAfterNestedAwait?.now().getTime()).toBe(outerClock.now().getTime());
		expect(getClock()).toBe(systemClock);
	});
});
