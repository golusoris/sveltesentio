import { describe, expect, it } from 'vitest';
import { appendBounded } from '../src/bounded-history.js';

describe('appendBounded', () => {
	// Positive: the ordinary case both composables rely on.
	it('appends a batch and preserves arrival order', () => {
		expect(appendBounded([1, 2], [3, 4], 10)).toEqual([1, 2, 3, 4]);
	});

	it('keeps the most recent entries when the limit is exceeded', () => {
		expect(appendBounded([1, 2, 3], [4, 5], 3)).toEqual([3, 4, 5]);
	});

	it('does not mutate the array it was given', () => {
		const current = [1, 2];
		const result = appendBounded(current, [3], 10);
		expect(current).toEqual([1, 2]);
		expect(result).not.toBe(current);
	});

	// Negative: degenerate limits keep nothing rather than throwing, matching the
	// behaviour of the inline code this replaced.
	it('keeps nothing for a zero or negative limit', () => {
		expect(appendBounded([1, 2], [3], 0)).toEqual([]);
		expect(appendBounded([1, 2], [3], -5)).toEqual([]);
	});

	// Boundary: exactly at the limit, one over, and empty inputs.
	it('keeps everything when the result lands exactly on the limit', () => {
		expect(appendBounded([1, 2], [3], 3)).toEqual([1, 2, 3]);
	});

	it('drops exactly one when the result is one over the limit', () => {
		expect(appendBounded([1, 2], [3], 2)).toEqual([2, 3]);
	});

	it('handles empty current, empty batch, and both empty', () => {
		expect(appendBounded([], [1, 2], 5)).toEqual([1, 2]);
		expect(appendBounded([1, 2], [], 5)).toEqual([1, 2]);
		expect(appendBounded([], [], 5)).toEqual([]);
	});

	it('truncates a single batch that alone exceeds the limit', () => {
		expect(appendBounded([], [1, 2, 3, 4], 2)).toEqual([3, 4]);
	});
});
