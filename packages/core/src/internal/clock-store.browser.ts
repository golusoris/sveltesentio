import type { ClockStore } from './clock-store.types.js';

/** Browser variant: no async context exists, so nothing is stored. */
export const clockStore: ClockStore = {
	getStore: () => undefined,
	run: (_clock, fn) => fn(),
};
