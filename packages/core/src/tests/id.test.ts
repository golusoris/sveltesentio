import { describe, it, expect } from 'vitest';
import { generateId, isId, idToTimestamp, brandId } from '../id.js';

describe('generateId', () => {
  it('returns a valid UUIDv7 string', () => {
    const id = generateId();
    expect(isId(id)).toBe(true);
  });

  it('contains version 7 in the correct nibble position', () => {
    const id = generateId();
    // Version nibble is the 13th hex character (index 14 with dashes)
    expect(id[14]).toBe('7');
  });

  it('variant bits are correct (8, 9, a, or b)', () => {
    const id = generateId();
    // Variant field is the 17th hex character (index 19 with dashes)
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it('IDs are lexicographically ordered over time', () => {
    const ids = Array.from({ length: 10 }, () => generateId());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('extracts correct timestamp from id', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();
    const ts = idToTimestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('isId', () => {
  it('accepts valid UUIDv7', () => {
    expect(isId(generateId())).toBe(true);
  });

  it('rejects non-uuid strings', () => {
    expect(isId('not-a-uuid')).toBe(false);
    expect(isId('')).toBe(false);
    expect(isId(123)).toBe(false);
    expect(isId(null)).toBe(false);
  });

  it('rejects UUIDv4 (wrong version nibble)', () => {
    expect(isId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });
});

describe('brandId', () => {
  it('brands a valid UUID', () => {
    const id = generateId();
    const branded = brandId<'User'>(id);
    expect(branded).toBe(id);
  });

  it('throws on invalid input', () => {
    expect(() => brandId('not-valid')).toThrow(TypeError);
  });
});
