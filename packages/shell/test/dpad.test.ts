import { describe, expect, it } from 'vitest';
import {
	type FocusCandidate,
	type FocusGraphSource,
	computeNextFocus,
	directionFromAxes,
	directionFromGamepadButton,
	directionFromKey,
	resolveNextFocus,
} from '../src/dpad';

/** Build a candidate as a unit square centred at (cx, cy). */
function cell(id: string, cx: number, cy: number): FocusCandidate {
	return { id, rect: { left: cx - 10, top: cy - 10, right: cx + 10, bottom: cy + 10 } };
}

// A 3×3 grid (100px spacing) centred on `center`.
const center = cell('center', 100, 100);
const grid: FocusCandidate[] = [
	cell('nw', 0, 0),
	cell('n', 100, 0),
	cell('ne', 200, 0),
	cell('w', 0, 100),
	center,
	cell('e', 200, 100),
	cell('sw', 0, 200),
	cell('s', 100, 200),
	cell('se', 200, 200),
];

describe('computeNextFocus', () => {
	it('picks the directly adjacent neighbour on each axis', () => {
		expect(computeNextFocus(center, 'up', grid)).toBe('n');
		expect(computeNextFocus(center, 'down', grid)).toBe('s');
		expect(computeNextFocus(center, 'left', grid)).toBe('w');
		expect(computeNextFocus(center, 'right', grid)).toBe('e');
	});

	it('prefers the squarely-aligned neighbour over a closer skewed one', () => {
		const skewed: FocusCandidate[] = [
			center,
			cell('aligned', 100, 0), // 100px straight up
			cell('skewed', 60, 30), // closer in raw distance but off-axis
		];
		expect(computeNextFocus(center, 'up', skewed)).toBe('aligned');
	});

	it('returns null when there is no neighbour in the direction', () => {
		const topRow: FocusCandidate[] = [cell('a', 0, 0), cell('b', 100, 0), cell('c', 200, 0)];
		expect(computeNextFocus(cell('a', 0, 0), 'up', topRow)).toBeNull();
	});

	it('ignores the current candidate even when present in the set', () => {
		expect(computeNextFocus(center, 'up', [center])).toBeNull();
	});

	it('returns null for an empty candidate set', () => {
		expect(computeNextFocus(center, 'down', [])).toBeNull();
	});

	it('routes a pure diagonal to the vertical axis, not the horizontal one', () => {
		const diag: FocusCandidate[] = [center, cell('downright', 200, 200)];
		// 45° tie: vertical claims it (>= on vertical, strict > on horizontal).
		expect(computeNextFocus(center, 'down', diag)).toBe('downright');
		expect(computeNextFocus(center, 'right', diag)).toBeNull();
	});
});

describe('directionFromKey', () => {
	it('maps arrow keys', () => {
		expect(directionFromKey('ArrowUp')).toBe('up');
		expect(directionFromKey('ArrowDown')).toBe('down');
		expect(directionFromKey('ArrowLeft')).toBe('left');
		expect(directionFromKey('ArrowRight')).toBe('right');
	});

	it('returns null for unrelated keys', () => {
		expect(directionFromKey('Enter')).toBeNull();
		expect(directionFromKey('a')).toBeNull();
	});
});

describe('directionFromGamepadButton', () => {
	it('maps standard D-pad buttons 12–15', () => {
		expect(directionFromGamepadButton(12)).toBe('up');
		expect(directionFromGamepadButton(13)).toBe('down');
		expect(directionFromGamepadButton(14)).toBe('left');
		expect(directionFromGamepadButton(15)).toBe('right');
	});

	it('returns null for face buttons / triggers', () => {
		expect(directionFromGamepadButton(0)).toBeNull();
		expect(directionFromGamepadButton(11)).toBeNull();
	});
});

describe('directionFromAxes', () => {
	it('returns null inside the deadzone', () => {
		expect(directionFromAxes(0.2, -0.3)).toBeNull();
		expect(directionFromAxes(0, 0)).toBeNull();
	});

	it('picks the dominant axis past the deadzone', () => {
		expect(directionFromAxes(-0.9, 0.1)).toBe('left');
		expect(directionFromAxes(0.9, -0.1)).toBe('right');
		expect(directionFromAxes(0.1, -0.9)).toBe('up');
		expect(directionFromAxes(0.1, 0.9)).toBe('down');
	});

	it('breaks an axis tie toward the horizontal', () => {
		expect(directionFromAxes(0.8, -0.8)).toBe('right');
		expect(directionFromAxes(-0.8, 0.8)).toBe('left');
	});

	it('honours a custom deadzone', () => {
		expect(directionFromAxes(0.6, 0, 0.7)).toBeNull();
		expect(directionFromAxes(0.8, 0, 0.7)).toBe('right');
	});
});

describe('resolveNextFocus', () => {
	const source: FocusGraphSource = {
		candidates: () => grid,
		current: () => 'center',
	};

	it('resolves the neighbour for the current cell', () => {
		expect(resolveNextFocus(source, 'up')).toBe('n');
		expect(resolveNextFocus(source, 'right')).toBe('e');
	});

	it('returns null when focus is outside the graph', () => {
		const outside: FocusGraphSource = { candidates: () => grid, current: () => null };
		expect(resolveNextFocus(outside, 'up')).toBeNull();
	});

	it('returns null when the current id is not among candidates', () => {
		const stale: FocusGraphSource = { candidates: () => grid, current: () => 'ghost' };
		expect(resolveNextFocus(stale, 'up')).toBeNull();
	});

	it('returns null when there is no neighbour in the direction', () => {
		const corner: FocusGraphSource = { candidates: () => grid, current: () => 'nw' };
		expect(resolveNextFocus(corner, 'up')).toBeNull();
	});
});
