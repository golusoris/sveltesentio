import { AsyncLocalStorage } from 'node:async_hooks';
import type { Clock } from '../clock.js';
import type { ClockStore } from './clock-store.types.js';

const als = new AsyncLocalStorage<Clock>({ name: 'clock' });

/** Server variant: one clock per request through `AsyncLocalStorage`. */
export const clockStore: ClockStore = {
	getStore: () => als.getStore(),
	run: (clock, fn) => als.run(clock, fn),
};
