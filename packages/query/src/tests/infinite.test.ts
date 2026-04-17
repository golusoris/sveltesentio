import { describe, it, expect } from 'vitest';
import { flattenPages, type PagedResponse } from '../infinite.js';
import type { InfiniteData } from '@tanstack/svelte-query';

describe('flattenPages', () => {
  it('flattens multiple pages into a single array', () => {
    const data: InfiniteData<PagedResponse<number>> = {
      pages: [
        { items: [1, 2, 3], nextCursor: 'cursor-2' },
        { items: [4, 5, 6], nextCursor: 'cursor-3' },
        { items: [7, 8], nextCursor: null },
      ],
      pageParams: [null, 'cursor-2', 'cursor-3'],
    };
    expect(flattenPages(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('returns empty array for undefined data', () => {
    expect(flattenPages(undefined)).toEqual([]);
  });

  it('returns empty array for pages with empty items', () => {
    const data: InfiniteData<PagedResponse<string>> = {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    };
    expect(flattenPages(data)).toEqual([]);
  });
});
