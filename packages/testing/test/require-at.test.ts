import { describe, expect, it } from 'vitest';
import { requireAt } from '../src/require-at.js';

describe('requireAt', () => {
	// Positive: the ordinary case.
	it('returns the element at the index', () => {
		expect(requireAt(['a', 'b', 'c'], 1)).toBe('b');
	});

	it('returns falsy elements rather than treating them as absent', () => {
		expect(requireAt([0, 1], 0)).toBe(0);
		expect(requireAt([''], 0)).toBe('');
		expect(requireAt([null], 0)).toBe(null);
	});

	// Negative: out of range fails, and the message carries the diagnosis.
	it('throws naming the index and the length actually found', () => {
		expect(() => requireAt(['a'], 3)).toThrow(
			'expected element at index 3, but the query returned 1',
		);
	});

	it('uses the supplied noun in the message', () => {
		expect(() => requireAt([], 0, 'option')).toThrow('expected option at index 0');
	});

	// Boundary: empty, first, last, and one past the end.
	it('handles the edges of the range', () => {
		expect(requireAt(['only'], 0)).toBe('only');
		expect(requireAt(['a', 'b'], 1)).toBe('b');
		expect(() => requireAt([], 0)).toThrow();
		expect(() => requireAt(['a', 'b'], 2)).toThrow();
	});

	it('treats an explicit undefined element as absent', () => {
		expect(() => requireAt([undefined], 0)).toThrow('index 0');
	});
});
