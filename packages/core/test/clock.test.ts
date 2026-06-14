import { describe, it, expect, beforeEach } from 'vitest';
import { getClock, systemClock, withClock } from '../src/clock';
import type { Clock } from '../src/clock';

function freshClock(now: Date): Clock {
	const ms = now.getTime();
	let t = ms;
	return {
		now: () => new Date(t),
		monotonic: () => t - ms,
	};
}

describe('systemClock', () => {
	it('now() returns a Date', () => {
		const d = systemClock.now();
		expect(d).toBeInstanceOf(Date);
	});

	it('monotonic() returns a finite number', () => {
		const m = systemClock.monotonic();
		expect(Number.isFinite(m)).toBe(true);
	});

	it('monotonic() is non-decreasing across two reads', () => {
		const a = systemClock.monotonic();
		const b = systemClock.monotonic();
		expect(b).toBeGreaterThanOrEqual(a);
	});
});

describe('getClock (server default)', () => {
	it('returns systemClock outside any ALS run', () => {
		expect(getClock()).toBe(systemClock);
	});
});

describe('withClock handle', () => {
	const pinned = new Date('2026-04-17T12:00:00Z');

	let handle: ReturnType<typeof withClock>;
	let clock: Clock;

	beforeEach(() => {
		clock = freshClock(pinned);
		handle = withClock(clock);
	});

	it('writes the clock onto event.locals', async () => {
		const locals: Record<string, unknown> = {};
		const event = { locals } as unknown as Parameters<typeof handle>[0]['event'];
		await handle({
			event,
			resolve: async () => new Response('ok'),
		} as unknown as Parameters<typeof handle>[0]);
		expect((locals as { clock?: Clock }).clock).toBe(clock);
	});

	it('rebinds getClock() inside the ALS-scoped resolve', async () => {
		const locals: Record<string, unknown> = {};
		const event = { locals } as unknown as Parameters<typeof handle>[0]['event'];

		let observed: Clock | undefined;
		await handle({
			event,
			resolve: async () => {
				observed = getClock();
				return new Response('ok');
			},
		} as unknown as Parameters<typeof handle>[0]);

		expect(observed).toBe(clock);
		expect(observed?.now().toISOString()).toBe(pinned.toISOString());
	});

	it('does not leak the bound clock past resolve', async () => {
		const locals: Record<string, unknown> = {};
		const event = { locals } as unknown as Parameters<typeof handle>[0]['event'];
		await handle({
			event,
			resolve: async () => new Response('ok'),
		} as unknown as Parameters<typeof handle>[0]);
		expect(getClock()).toBe(systemClock);
	});
});
