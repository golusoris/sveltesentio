import { describe, expect, it } from 'vitest';
import { brandId, idToTimestamp, isId, isIdV4, newId, newIdV4 } from '../src/id';

describe('newId', () => {
	it('produces a valid UUIDv7', () => {
		const id = newId();
		expect(isId(id)).toBe(true);
	});

	it('is unique across calls', () => {
		const ids = new Set(Array.from({ length: 100 }, () => newId()));
		expect(ids.size).toBe(100);
	});

	it('is time-ordered when spaced by a millisecond', async () => {
		const a = newId();
		await new Promise((r) => setTimeout(r, 2));
		const b = newId();
		expect(a < b).toBe(true);
	});
});

describe('newIdV4', () => {
	it('produces a valid UUIDv4', () => {
		expect(isIdV4(newIdV4())).toBe(true);
	});

	it('is not recognised as UUIDv7', () => {
		expect(isId(newIdV4())).toBe(false);
	});
});

describe('idToTimestamp', () => {
	it('extracts the embedded millisecond timestamp', () => {
		const before = Date.now();
		const id = newId();
		const after = Date.now();
		const ts = idToTimestamp(id);
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});

	it('rejects non-UUIDv7 input', () => {
		expect(() => idToTimestamp(newIdV4())).toThrow();
	});
});

describe('brandId', () => {
	it('returns the input typed as Id<Brand>', () => {
		const id = newId();
		const branded = brandId<'UserId'>(id);
		expect(branded).toBe(id);
	});

	it('rejects invalid input', () => {
		expect(() => brandId<'UserId'>('not-a-uuid')).toThrow();
	});
});
