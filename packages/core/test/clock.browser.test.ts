import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../src/clock';

// Force the browser code paths: esm-env's BROWSER is statically false under
// node, so the `if (BROWSER)` and `BROWSER ? performance.now() : ...` branches
// are otherwise unreachable here. Flip it to true and back the context API
// with a Map so client-side clock resolution can be tested.
vi.mock('esm-env', () => ({ BROWSER: true }));

const ctx = new Map<unknown, unknown>();
vi.mock('svelte', () => ({
	setContext: (key: unknown, value: unknown) => {
		ctx.set(key, value);
		return value;
	},
	getContext: (key: unknown) => ctx.get(key),
	hasContext: (key: unknown) => ctx.has(key),
}));

const { setClock, useClock, getClock, systemClock, createHydrationClock } =
	await import('../src/clock');

function freshClock(now: Date): Clock {
	const ms = now.getTime();
	return {
		now: () => new Date(ms),
		monotonic: () => 0,
	};
}

afterEach(() => {
	ctx.clear();
});

describe('clock — browser paths (BROWSER=true)', () => {
	it('systemClock.monotonic uses performance.now in the browser', () => {
		const m = systemClock.monotonic();
		expect(Number.isFinite(m)).toBe(true);
		expect(m).toBeGreaterThanOrEqual(0);
	});

	it('setClock updates clientClock so getClock reflects it', () => {
		const clock = freshClock(new Date('2026-05-01T00:00:00Z'));
		setClock(clock);
		expect(getClock()).toBe(clock);
	});

	it('useClock prefers context over clientClock', () => {
		const client = freshClock(new Date('2026-05-01T00:00:00Z'));
		const context = freshClock(new Date('2026-06-01T00:00:00Z'));
		// setClock writes both context (via setContext) and clientClock.
		setClock(client);
		ctx.set(Symbol.for('sveltesentio.clock'), context);
		expect(useClock()).toBe(context);
	});

	it('useClock falls back to clientClock when no context present', () => {
		const client = freshClock(new Date('2026-05-01T00:00:00Z'));
		setClock(client);
		ctx.clear();
		expect(useClock()).toBe(client);
	});
});

describe('createHydrationClock — browser paths', () => {
	let perfValue: number;

	beforeEach(() => {
		perfValue = 1000;
		vi.spyOn(performance, 'now').mockImplementation(() => perfValue);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the exact server time on the first read', () => {
		const serverNow = new Date('2026-03-03T03:03:03.000Z');
		const clock = createHydrationClock(serverNow);
		expect(clock.now().toISOString()).toBe(serverNow.toISOString());
	});

	it('advances by the monotonic delta on subsequent reads', () => {
		const serverNow = new Date('2026-03-03T03:03:03.000Z');
		const clock = createHydrationClock(serverNow);
		expect(clock.now().getTime()).toBe(serverNow.getTime()); // firstRead
		perfValue = 1250; // 250ms of monotonic time has elapsed
		expect(clock.now().getTime()).toBe(serverNow.getTime() + 250);
		perfValue = 2000; // 1000ms total since hydration
		expect(clock.now().getTime()).toBe(serverNow.getTime() + 1000);
	});

	it('monotonic reports the browser performance clock', () => {
		const clock = createHydrationClock(new Date());
		perfValue = 4242;
		expect(clock.monotonic()).toBe(4242);
	});
});
