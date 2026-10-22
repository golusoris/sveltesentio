import type { Clock } from '../src/clock';

export const ctx = new Map<unknown, unknown>();

export function svelteContextMock(map = ctx) {
	return {
		setContext: (key: unknown, value: unknown) => {
			map.set(key, value);
			return value;
		},
		getContext: (key: unknown) => map.get(key),
		hasContext: (key: unknown) => map.has(key),
	};
}

export function freshClock(now: Date): Clock {
	const ms = now.getTime();
	return {
		now: () => new Date(ms),
		monotonic: () => 0,
	};
}
