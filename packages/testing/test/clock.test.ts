import { describe, it, expect } from 'vitest';
import { testClock } from '../src/clock';

const pinned = new Date('2026-04-17T12:00:00.000Z');

describe('testClock', () => {
	it('returns a Date equal to the constructor `now` on first read', () => {
		const c = testClock({ now: pinned });
		expect(c.now().toISOString()).toBe(pinned.toISOString());
	});

	it('monotonic() starts at 0', () => {
		const c = testClock({ now: pinned });
		expect(c.monotonic()).toBe(0);
	});

	it('advance(ms) rolls now() forward deterministically', () => {
		const c = testClock({ now: pinned });
		c.advance(60_000);
		expect(c.now().toISOString()).toBe('2026-04-17T12:01:00.000Z');
		expect(c.monotonic()).toBe(60_000);
	});

	it('advance is additive across calls', () => {
		const c = testClock({ now: pinned });
		c.advance(1000);
		c.advance(2000);
		expect(c.monotonic()).toBe(3000);
	});

	it('set(next) replaces the current instant without touching the monotonic origin', () => {
		const c = testClock({ now: pinned });
		c.set(new Date('2026-04-17T13:00:00.000Z'));
		expect(c.now().toISOString()).toBe('2026-04-17T13:00:00.000Z');
		expect(c.monotonic()).toBe(60 * 60 * 1000);
	});

	it('each call returns a fresh Date instance (no aliasing)', () => {
		const c = testClock({ now: pinned });
		const a = c.now();
		const b = c.now();
		expect(a).not.toBe(b);
		expect(a.getTime()).toBe(b.getTime());
	});

	it('two instances are independent', () => {
		const a = testClock({ now: pinned });
		const b = testClock({ now: pinned });
		a.advance(1000);
		expect(a.monotonic()).toBe(1000);
		expect(b.monotonic()).toBe(0);
	});
});
