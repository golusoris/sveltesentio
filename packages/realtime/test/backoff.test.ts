import { describe, expect, it } from 'vitest';
import { computeBackoff } from '../src/backoff.js';

describe('computeBackoff', () => {
	it('returns a value in [minMs, maxMs] for positive attempts', () => {
		for (let attempt = 0; attempt < 15; attempt += 1) {
			const delay = computeBackoff(attempt, { minMs: 1000, maxMs: 30_000 });
			expect(delay).toBeGreaterThanOrEqual(1000);
			expect(delay).toBeLessThanOrEqual(30_000);
		}
	});

	it('never returns less than minMs even for negative/NaN inputs', () => {
		expect(computeBackoff(-1, { minMs: 500 })).toBe(500);
		expect(computeBackoff(Number.NaN, { minMs: 500 })).toBe(500);
	});

	it('doubles by default (base 2) before jitter', () => {
		const noJitter = { jitter: 0, random: () => 0.5 } as const;
		const d0 = computeBackoff(0, noJitter);
		const d1 = computeBackoff(1, noJitter);
		const d2 = computeBackoff(2, noJitter);
		expect(d1).toBe(d0 * 2);
		expect(d2).toBe(d0 * 4);
	});

	it('applies jitter symmetrically around the capped raw', () => {
		const low = computeBackoff(2, { minMs: 1000, maxMs: 30_000, jitter: 0.3, random: () => 0 });
		const mid = computeBackoff(2, { minMs: 1000, maxMs: 30_000, jitter: 0.3, random: () => 0.5 });
		const high = computeBackoff(2, { minMs: 1000, maxMs: 30_000, jitter: 0.3, random: () => 1 });
		expect(low).toBeLessThan(mid);
		expect(mid).toBeLessThan(high);
	});

	it('rejects invalid jitter bounds', () => {
		expect(() => computeBackoff(1, { jitter: -0.1 })).toThrow(RangeError);
		expect(() => computeBackoff(1, { jitter: 1 })).toThrow(RangeError);
	});

	it('caps huge attempts at maxMs', () => {
		const delay = computeBackoff(50, { minMs: 1000, maxMs: 10_000, jitter: 0 });
		expect(delay).toBeLessThanOrEqual(10_000);
		expect(delay).toBeGreaterThanOrEqual(1000);
	});
});
