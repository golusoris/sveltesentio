import { describe, it, expect } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import {
	actionForKey,
	assertCaptionsContract,
	formatMediaTime,
	clampVolume,
	type MediaTrack,
} from '../src/player-controls';

describe('actionForKey', () => {
	it('maps Space / k to toggle-play', () => {
		expect(actionForKey({ key: ' ' })).toBe('toggle-play');
		expect(actionForKey({ key: 'Spacebar' })).toBe('toggle-play');
		expect(actionForKey({ key: 'k' })).toBe('toggle-play');
		expect(actionForKey({ key: 'K' })).toBe('toggle-play');
	});

	it('maps arrow keys to seek / volume', () => {
		expect(actionForKey({ key: 'ArrowLeft' })).toBe('seek-back');
		expect(actionForKey({ key: 'ArrowRight' })).toBe('seek-forward');
		expect(actionForKey({ key: 'ArrowUp' })).toBe('volume-up');
		expect(actionForKey({ key: 'ArrowDown' })).toBe('volume-down');
	});

	it('maps m / f / c (case-insensitive)', () => {
		expect(actionForKey({ key: 'M' })).toBe('toggle-mute');
		expect(actionForKey({ key: 'f' })).toBe('toggle-fullscreen');
		expect(actionForKey({ key: 'C' })).toBe('toggle-captions');
	});

	it('returns undefined for unmapped keys', () => {
		expect(actionForKey({ key: 'Enter' })).toBeUndefined();
		expect(actionForKey({ key: 'z' })).toBeUndefined();
	});

	it('ignores keys held with a modifier (no chord hijack)', () => {
		expect(actionForKey({ key: ' ', ctrlKey: true })).toBeUndefined();
		expect(actionForKey({ key: 'k', metaKey: true })).toBeUndefined();
		expect(actionForKey({ key: 'f', altKey: true })).toBeUndefined();
	});
});

describe('assertCaptionsContract', () => {
	const captions: MediaTrack[] = [
		{ src: '/en.vtt', kind: 'captions', srclang: 'en', label: 'English', default: true },
	];

	it('passes for video when tracks supplied', () => {
		expect(() => assertCaptionsContract('video', captions)).not.toThrow();
	});

	it('passes for video with an explicit empty opt-out', () => {
		expect(() => assertCaptionsContract('video', [])).not.toThrow();
	});

	it('passes for audio regardless of tracks', () => {
		expect(() => assertCaptionsContract('audio', undefined)).not.toThrow();
	});

	it('throws a ProblemError for video with no tracks prop', () => {
		try {
			assertCaptionsContract('video', undefined);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(ProblemError);
			const problem = err as ProblemError;
			expect(problem.status).toBe(500);
			expect(problem.type).toBe(
				'https://sveltesentio.dev/problems/media/captions-required',
			);
		}
	});
});

describe('formatMediaTime', () => {
	it('formats sub-hour times as M:SS', () => {
		expect(formatMediaTime(0)).toBe('0:00');
		expect(formatMediaTime(5)).toBe('0:05');
		expect(formatMediaTime(65)).toBe('1:05');
		expect(formatMediaTime(600)).toBe('10:00');
	});

	it('formats hour-plus times as H:MM:SS', () => {
		expect(formatMediaTime(3600)).toBe('1:00:00');
		expect(formatMediaTime(3661)).toBe('1:01:01');
		expect(formatMediaTime(7325)).toBe('2:02:05');
	});

	it('clamps negative / non-finite input to 0:00', () => {
		expect(formatMediaTime(-10)).toBe('0:00');
		expect(formatMediaTime(Number.NaN)).toBe('0:00');
		expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe('0:00');
	});

	it('floors fractional seconds', () => {
		expect(formatMediaTime(9.9)).toBe('0:09');
	});
});

describe('clampVolume', () => {
	it('clamps to the [0, 1] range', () => {
		expect(clampVolume(0.5)).toBe(0.5);
		expect(clampVolume(2)).toBe(1);
		expect(clampVolume(-1)).toBe(0);
	});

	it('applies a step before clamping', () => {
		expect(clampVolume(0.5, 0.1)).toBeCloseTo(0.6);
		expect(clampVolume(0.95, 0.1)).toBe(1);
		expect(clampVolume(0.05, -0.1)).toBe(0);
	});

	it('maps non-finite input to 0', () => {
		expect(clampVolume(Number.NaN)).toBe(0);
		expect(clampVolume(Number.NaN, 0.1)).toBe(0);
	});
});
