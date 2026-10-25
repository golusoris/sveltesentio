import { describe, it, expect, beforeEach } from 'vitest';
import { createHydrationClock, getClock, systemClock, withClock } from '../src/clock';
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

	async function invokeHandle(
		resolve: () => Promise<Response> = () => Promise.resolve(new Response('ok')),
	): Promise<Record<string, unknown>> {
		const locals: Record<string, unknown> = {};
		const event = { locals } as unknown as Parameters<typeof handle>[0]['event'];
		await handle({
			event,
			resolve,
		});
		return locals;
	}

	it('writes the clock onto event.locals', async () => {
		const locals = await invokeHandle();
		expect((locals as { clock?: Clock }).clock).toBe(clock);
	});

	it('rebinds getClock() inside the ALS-scoped resolve', async () => {
		let observed: Clock | undefined;
		await invokeHandle(() => {
			observed = getClock();
			return Promise.resolve(new Response('ok'));
		});

		expect(observed).toBe(clock);
		expect(observed?.now().toISOString()).toBe(pinned.toISOString());
	});

	it('does not leak the bound clock past resolve', async () => {
		await invokeHandle();
		expect(getClock()).toBe(systemClock);
	});
});

describe('createHydrationClock (server, BROWSER=false)', () => {
	const serverNow = new Date('2026-04-17T12:00:00.000Z');

	it('returns the server time on the first read', () => {
		const clock = createHydrationClock(serverNow);
		expect(clock.now().toISOString()).toBe(serverNow.toISOString());
	});

	it('returns the server time on subsequent reads (no monotonic drift on the server)', () => {
		const clock = createHydrationClock(serverNow);
		expect(clock.now().getTime()).toBe(serverNow.getTime()); // firstRead branch
		// On the server the monotonic delta is fixed at 0, so time does not advance.
		expect(clock.now().getTime()).toBe(serverNow.getTime());
		expect(clock.now().getTime()).toBe(serverNow.getTime());
	});

	it('monotonic is 0 on the server', () => {
		const clock = createHydrationClock(serverNow);
		expect(clock.monotonic()).toBe(0);
	});
});
