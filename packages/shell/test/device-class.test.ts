import { describe, expect, it } from 'vitest';
import {
	HANDHELD_MAX_WIDTH,
	TENFOOT_MIN_WIDTH,
	classifyDevice,
	readDeviceSignals,
} from '../src/device-class';

describe('classifyDevice', () => {
	it('honours an explicit tv hint above everything else', () => {
		expect(classifyDevice({ pointerCoarse: false, viewportWidth: 400, tv: true })).toBe('10foot');
		expect(classifyDevice({ pointerCoarse: true, viewportWidth: 320, tv: true })).toBe('10foot');
	});

	it('treats a large coarse-pointer screen as 10foot (TV remote)', () => {
		expect(classifyDevice({ pointerCoarse: true, viewportWidth: TENFOOT_MIN_WIDTH })).toBe(
			'10foot',
		);
		expect(classifyDevice({ pointerCoarse: true, viewportWidth: 1920 })).toBe('10foot');
	});

	it('treats a small coarse-pointer screen as handheld', () => {
		expect(classifyDevice({ pointerCoarse: true, viewportWidth: 390 })).toBe('handheld');
		expect(classifyDevice({ pointerCoarse: true, viewportWidth: TENFOOT_MIN_WIDTH - 1 })).toBe(
			'handheld',
		);
	});

	it('treats a narrow fine-pointer surface as handheld', () => {
		expect(classifyDevice({ pointerCoarse: false, viewportWidth: HANDHELD_MAX_WIDTH - 1 })).toBe(
			'handheld',
		);
	});

	it('treats a wide fine-pointer surface as desktop', () => {
		expect(classifyDevice({ pointerCoarse: false, viewportWidth: HANDHELD_MAX_WIDTH })).toBe(
			'desktop',
		);
		expect(classifyDevice({ pointerCoarse: false, viewportWidth: 2560 })).toBe('desktop');
	});

	it('defaults tv to false when omitted', () => {
		expect(classifyDevice({ pointerCoarse: false, viewportWidth: 1440 })).toBe('desktop');
	});
});

describe('readDeviceSignals', () => {
	it('returns an SSR-safe desktop-leaning default without window', () => {
		// In the node test environment there is no `window`.
		const signals = readDeviceSignals();
		expect(signals.pointerCoarse).toBe(false);
		expect(signals.viewportWidth).toBe(HANDHELD_MAX_WIDTH);
		expect(classifyDevice(signals)).toBe('desktop');
	});
});
