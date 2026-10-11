import { AsyncLocalStorage } from 'node:async_hooks';
import { getContext, hasContext, setContext } from 'svelte';
import { BROWSER } from 'esm-env';
import type { sequence } from '@sveltejs/kit/hooks';

/**
 * SvelteKit's `Handle` hook type, derived from `sequence` instead of imported by
 * name. SvelteKit 2 exports `Handle` from `@sveltejs/kit` only, SvelteKit 3 from
 * `@sveltejs/kit/hooks` only; `sequence` is exported from `@sveltejs/kit/hooks`
 * by both, and its parameters are `Handle[]` in both. A named import would tie
 * this module to one of the two majors.
 */
type Handle = Parameters<typeof sequence>[number];

export interface Clock {
	now(): Date;
	monotonic(): number;
}

export const systemClock: Clock = {
	now: () => new Date(),
	monotonic: () => (BROWSER ? performance.now() : Number(process.hrtime.bigint()) / 1e6),
};

const CLOCK_KEY = Symbol.for('sveltesentio.clock');

const als: AsyncLocalStorage<Clock> | null = BROWSER
	? null
	: new AsyncLocalStorage<Clock>({ name: 'clock', defaultValue: systemClock });

let clientClock: Clock = systemClock;

export function setClock(clock: Clock): void {
	setContext(CLOCK_KEY, clock);
	if (BROWSER) clientClock = clock;
}

export function useClock(): Clock {
	if (hasContext(CLOCK_KEY)) return getContext<Clock>(CLOCK_KEY);
	if (BROWSER) return clientClock;
	return als?.getStore() ?? systemClock;
}

export function getClock(): Clock {
	if (BROWSER) return clientClock;
	return als?.getStore() ?? systemClock;
}

export function withClock(clock: Clock): Handle {
	return ({ event, resolve }) => {
		(event.locals as { clock?: Clock }).clock = clock;
		if (!als) return resolve(event);
		return als.run(clock, () => resolve(event));
	};
}

export function createHydrationClock(serverNow: Date): Clock {
	const serverMs = serverNow.getTime();
	const monotonicAtHydration = BROWSER ? performance.now() : 0;
	let firstRead = true;
	return {
		now: () => {
			if (firstRead) {
				firstRead = false;
				return new Date(serverMs);
			}
			const delta = BROWSER ? performance.now() - monotonicAtHydration : 0;
			return new Date(serverMs + delta);
		},
		monotonic: () => (BROWSER ? performance.now() : 0),
	};
}
