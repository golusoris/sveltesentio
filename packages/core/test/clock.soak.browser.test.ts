// Long-session soak suite for createHydrationClock in the browser (BROWSER=true;
// gap audit C14-11). Each post-hydration read computes its elapsed offset from
// the absolute difference `performance.now() - monotonicAtHydration` added to
// `serverMs`, so fractional steps never accumulate drift over long sessions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ctx, svelteContextMock } from './clock-fixtures';

vi.mock('esm-env', () => ({ BROWSER: true }));
vi.mock('svelte', () => svelteContextMock());

const { createHydrationClock } = await import('../src/clock');

const READS = 10_000;
const STEP_MS = 16.75;
const THIRTY_DAYS_MS = 30 * 86_400_000;
const SERVER_NOW_A = new Date('2026-04-17T12:00:00.000Z');
const SERVER_NOW_B = new Date('2026-04-17T13:30:00.000Z');

let perfValue = 1000;

beforeEach(() => {
	perfValue = 1000;
	vi.spyOn(performance, 'now').mockImplementation(() => perfValue);
});

afterEach(() => {
	ctx.clear();
	vi.restoreAllMocks();
});

describe('createHydrationClock soak — drift-free progression (positive)', () => {
	it('tracks exact absolute floor deltas monotonically over READS steps (positive)', () => {
		const serverMs = SERVER_NOW_A.getTime();
		const clock = createHydrationClock(SERVER_NOW_A);
		let previousMs = clock.now().getTime();
		expect(previousMs).toBe(serverMs);

		for (let i = 1; i <= READS; i += 1) {
			perfValue = 1000 + i * STEP_MS;
			const currentMs = clock.now().getTime();
			expect(currentMs).toBe(serverMs + Math.floor(i * STEP_MS));
			expect(currentMs).toBeGreaterThanOrEqual(previousMs);
			previousMs = currentMs;
		}
	});

	it('reports exact serverMs + THIRTY_DAYS_MS after READS reads (positive)', () => {
		const serverMs = SERVER_NOW_A.getTime();
		const clock = createHydrationClock(SERVER_NOW_A);
		expect(clock.now().getTime()).toBe(serverMs);

		for (let i = 1; i <= READS; i += 1) {
			perfValue = 1000 + i * STEP_MS;
			clock.now();
		}

		perfValue = 1000 + THIRTY_DAYS_MS;
		expect(clock.now().getTime()).toBe(serverMs + THIRTY_DAYS_MS);
	});
});

describe('createHydrationClock soak — independent instances (negative)', () => {
	it('keeps separate origins and server times across two clocks (negative)', () => {
		const serverMsA = SERVER_NOW_A.getTime();
		const serverMsB = SERVER_NOW_B.getTime();
		const clockA = createHydrationClock(SERVER_NOW_A);
		expect(clockA.now().getTime()).toBe(serverMsA);

		perfValue = 2500;
		const clockB = createHydrationClock(SERVER_NOW_B);

		perfValue = 2800;
		expect(clockB.now().getTime()).toBe(serverMsB);
		expect(clockA.now().getTime()).toBe(serverMsA + 1800);

		for (let i = 1; i <= READS; i += 1) {
			perfValue = 2800 + i * STEP_MS;
			expect(clockA.now().getTime()).toBe(serverMsA + Math.floor(1800 + i * STEP_MS));
			expect(clockB.now().getTime()).toBe(serverMsB + Math.floor(300 + i * STEP_MS));
		}
	});
});

describe('createHydrationClock soak — stationary monotonic clock (boundary)', () => {
	it('returns serverMs with zero creep across READS unchanged reads (boundary)', () => {
		const serverMs = SERVER_NOW_A.getTime();
		const clock = createHydrationClock(SERVER_NOW_A);
		expect(clock.now().getTime()).toBe(serverMs);

		for (let i = 0; i < READS; i += 1) {
			expect(clock.now().getTime()).toBe(serverMs);
		}
	});
});
