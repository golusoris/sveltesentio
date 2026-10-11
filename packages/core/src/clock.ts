import { clockStore } from '#clock-store';
import { getContext, hasContext, setContext } from 'svelte';
import { BROWSER } from 'esm-env';
import type { Handle } from '@sveltejs/kit';

export interface Clock {
	now(): Date;
	monotonic(): number;
}

export const systemClock: Clock = {
	now: () => new Date(),
	monotonic: () => (BROWSER ? performance.now() : Number(process.hrtime.bigint()) / 1e6),
};

const CLOCK_KEY = Symbol.for('sveltesentio.clock');

let clientClock: Clock = systemClock;

export function setClock(clock: Clock): void {
	setContext(CLOCK_KEY, clock);
	if (BROWSER) clientClock = clock;
}

export function useClock(): Clock {
	if (hasContext(CLOCK_KEY)) return getContext<Clock>(CLOCK_KEY);
	if (BROWSER) return clientClock;
	return clockStore.getStore() ?? systemClock;
}

export function getClock(): Clock {
	if (BROWSER) return clientClock;
	return clockStore.getStore() ?? systemClock;
}

export function withClock(clock: Clock): Handle {
	return ({ event, resolve }) => {
		(event.locals as { clock?: Clock }).clock = clock;
		return clockStore.run(clock, () => resolve(event));
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
