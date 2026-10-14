import { describe, expect, it } from 'vitest';
import { applyTransportAction, type PlayerAction } from '../src/player-controls.js';

interface FakeMediaState {
	paused: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	playCount: number;
	pauseCount: number;
}

function createFakeMedia(initial?: Partial<FakeMediaState>): {
	el: HTMLMediaElement;
	state: FakeMediaState;
} {
	const state: FakeMediaState = {
		paused: true,
		currentTime: 0,
		duration: 100,
		volume: 0.5,
		playCount: 0,
		pauseCount: 0,
		...initial,
	};

	const fake = {
		get paused(): boolean {
			return state.paused;
		},
		set paused(v: boolean) {
			state.paused = v;
		},
		get currentTime(): number {
			return state.currentTime;
		},
		set currentTime(v: number) {
			state.currentTime = v;
		},
		get duration(): number {
			return state.duration;
		},
		set duration(v: number) {
			state.duration = v;
		},
		get volume(): number {
			return state.volume;
		},
		set volume(v: number) {
			state.volume = v;
		},
		play(): Promise<void> {
			state.playCount += 1;
			state.paused = false;
			return Promise.resolve();
		},
		pause(): void {
			state.pauseCount += 1;
			state.paused = true;
		},
	};

	return { el: fake as unknown as HTMLMediaElement, state };
}

describe('applyTransportAction', () => {
	describe('toggle-play', () => {
		it('plays when paused and returns true', () => {
			const { el, state } = createFakeMedia({ paused: true });
			const handled = applyTransportAction(el, 'toggle-play');

			expect(handled).toBe(true);
			expect(state.playCount).toBe(1);
			expect(state.pauseCount).toBe(0);
		});

		it('pauses when playing and returns true', () => {
			const { el, state } = createFakeMedia({ paused: false });
			const handled = applyTransportAction(el, 'toggle-play');

			expect(handled).toBe(true);
			expect(state.pauseCount).toBe(1);
			expect(state.playCount).toBe(0);
		});
	});

	describe('seek-back', () => {
		it('decrements currentTime by 5 seconds', () => {
			const { el, state } = createFakeMedia({ currentTime: 20 });
			const handled = applyTransportAction(el, 'seek-back');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(15);
		});

		it('boundary: clamps to 0 when near beginning', () => {
			const { el, state } = createFakeMedia({ currentTime: 2 });
			const handled = applyTransportAction(el, 'seek-back');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(0);
		});

		it('boundary: remains 0 when already at 0', () => {
			const { el, state } = createFakeMedia({ currentTime: 0 });
			const handled = applyTransportAction(el, 'seek-back');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(0);
		});
	});

	describe('seek-forward', () => {
		it('increments currentTime by 5 seconds', () => {
			const { el, state } = createFakeMedia({ currentTime: 20, duration: 100 });
			const handled = applyTransportAction(el, 'seek-forward');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(25);
		});

		it('boundary: clamps to duration when near end', () => {
			const { el, state } = createFakeMedia({ currentTime: 98, duration: 100 });
			const handled = applyTransportAction(el, 'seek-forward');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(100);
		});

		it('boundary: remains at duration when at end', () => {
			const { el, state } = createFakeMedia({ currentTime: 100, duration: 100 });
			const handled = applyTransportAction(el, 'seek-forward');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(100);
		});

		it('boundary: handles zero or unbounded duration using Infinity fallback', () => {
			const { el, state } = createFakeMedia({ currentTime: 10, duration: 0 });
			const handled = applyTransportAction(el, 'seek-forward');

			expect(handled).toBe(true);
			expect(state.currentTime).toBe(15);
		});
	});

	describe('volume-up', () => {
		it('increments volume by 0.1', () => {
			const { el, state } = createFakeMedia({ volume: 0.5 });
			const handled = applyTransportAction(el, 'volume-up');

			expect(handled).toBe(true);
			expect(state.volume).toBeCloseTo(0.6);
		});

		it('boundary: clamps to 1 when near ceiling', () => {
			const { el, state } = createFakeMedia({ volume: 0.95 });
			const handled = applyTransportAction(el, 'volume-up');

			expect(handled).toBe(true);
			expect(state.volume).toBe(1);
		});

		it('boundary: remains 1 when at ceiling', () => {
			const { el, state } = createFakeMedia({ volume: 1 });
			const handled = applyTransportAction(el, 'volume-up');

			expect(handled).toBe(true);
			expect(state.volume).toBe(1);
		});
	});

	describe('volume-down', () => {
		it('decrements volume by 0.1', () => {
			const { el, state } = createFakeMedia({ volume: 0.5 });
			const handled = applyTransportAction(el, 'volume-down');

			expect(handled).toBe(true);
			expect(state.volume).toBeCloseTo(0.4);
		});

		it('boundary: clamps to 0 when near floor', () => {
			const { el, state } = createFakeMedia({ volume: 0.05 });
			const handled = applyTransportAction(el, 'volume-down');

			expect(handled).toBe(true);
			expect(state.volume).toBe(0);
		});

		it('boundary: remains 0 when at floor', () => {
			const { el, state } = createFakeMedia({ volume: 0 });
			const handled = applyTransportAction(el, 'volume-down');

			expect(handled).toBe(true);
			expect(state.volume).toBe(0);
		});
	});

	describe('non-transport and unknown actions', () => {
		it('returns false for actions handled at component level', () => {
			const { el } = createFakeMedia();
			expect(applyTransportAction(el, 'toggle-mute')).toBe(false);
			expect(applyTransportAction(el, 'toggle-fullscreen')).toBe(false);
			expect(applyTransportAction(el, 'toggle-captions')).toBe(false);
		});

		it('returns false for unknown actions', () => {
			const { el } = createFakeMedia();
			expect(applyTransportAction(el, 'unknown-action' as unknown as PlayerAction)).toBe(false);
		});
	});
});
