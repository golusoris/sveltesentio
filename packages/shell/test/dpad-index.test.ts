import { describe, expect, it } from 'vitest';
import * as dpad from '../src/dpad-index';

// The `./dpad` sub-export is a pure barrel: it must surface the whole
// focus-graph engine plus the Svelte navigation action under one import so
// downstream `@sveltesentio/shell/dpad` consumers get geometry + action
// together. A regression here (a dropped re-export after a refactor) would
// silently break that public contract, so assert each named member.
describe('dpad barrel (src/dpad-index)', () => {
	it('re-exports the pure geometry + input-mapping engine', () => {
		expect(typeof dpad.computeNextFocus).toBe('function');
		expect(typeof dpad.directionFromKey).toBe('function');
		expect(typeof dpad.directionFromGamepadButton).toBe('function');
		expect(typeof dpad.directionFromAxes).toBe('function');
		expect(typeof dpad.resolveNextFocus).toBe('function');
	});

	it('re-exports the Svelte navigation action', () => {
		expect(typeof dpad.dpadNavigation).toBe('function');
	});

	it('wires the re-exported engine through identically to the source module', () => {
		// Same call as the engine test, reached via the barrel — proves it is the
		// real function, not a stub.
		expect(dpad.directionFromKey('ArrowUp')).toBe('up');
		expect(dpad.directionFromGamepadButton(15)).toBe('right');
		expect(dpad.directionFromAxes(-0.9, 0.1)).toBe('left');
	});

	it('does not leak unexpected runtime members beyond the documented surface', () => {
		const runtimeMembers = Object.keys(dpad)
			.filter((key) => typeof (dpad as Record<string, unknown>)[key] === 'function')
			.sort();
		expect(runtimeMembers).toEqual([
			'computeNextFocus',
			'directionFromAxes',
			'directionFromGamepadButton',
			'directionFromKey',
			'dpadNavigation',
			'resolveNextFocus',
		]);
	});
});
