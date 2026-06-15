import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../src/clock';

// setClock / useClock touch Svelte's context API, which throws outside a
// component. Mock the three context primitives with a simple Map-backed store
// so the context-resolution branches can be exercised in a plain node test.
const ctx = new Map<unknown, unknown>();
vi.mock('svelte', () => ({
	setContext: (key: unknown, value: unknown) => {
		ctx.set(key, value);
		return value;
	},
	getContext: (key: unknown) => ctx.get(key),
	hasContext: (key: unknown) => ctx.has(key),
}));

const { setClock, useClock, getClock, systemClock } = await import('../src/clock');

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

describe('setClock + useClock (context path)', () => {
	it('useClock returns the context clock once setClock has run', () => {
		const clock = freshClock(new Date('2026-01-02T03:04:05Z'));
		setClock(clock);
		expect(useClock()).toBe(clock);
	});

	it('useClock falls back to systemClock when no context is set (server)', () => {
		expect(useClock()).toBe(systemClock);
	});

	it('getClock ignores context and returns systemClock on the server', () => {
		const clock = freshClock(new Date('2026-01-02T03:04:05Z'));
		setClock(clock);
		// getClock never consults Svelte context — only ALS / clientClock.
		expect(getClock()).toBe(systemClock);
	});
});
