import type { Clock } from '@sveltesentio/core/clock';

export interface TestClock extends Clock {
	advance(ms: number): void;
	set(now: Date): void;
}

export function testClock({ now }: { now: Date }): TestClock {
	const start = now.getTime();
	let t = start;
	return {
		now: () => new Date(t),
		monotonic: () => t - start,
		advance: (ms) => {
			t += ms;
		},
		set: (next) => {
			t = next.getTime();
		},
	};
}
