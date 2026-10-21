import { afterEach, describe, expect, it, vi } from 'vitest';
import { ctx, freshClock, svelteContextMock } from './clock-fixtures';

// setClock / useClock touch Svelte's context API, which throws outside a
// component. Mock the three context primitives with a simple Map-backed store
// so the context-resolution branches can be exercised in a plain node test.
vi.mock('svelte', () => svelteContextMock());

const { setClock, useClock, getClock, systemClock } = await import('../src/clock');

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
