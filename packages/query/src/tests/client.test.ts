import { describe, it, expect } from 'vitest';
import { createApiClient } from '../client.js';

describe('createApiClient', () => {
  it('returns a client object with GET/POST/PUT/DELETE/PATCH methods', () => {
    const client = createApiClient<Record<string, Record<string, unknown>>>({
      baseUrl: 'http://localhost:8080',
    });
    expect(typeof client.GET).toBe('function');
    expect(typeof client.POST).toBe('function');
    expect(typeof client.PUT).toBe('function');
    expect(typeof client.DELETE).toBe('function');
    expect(typeof client.PATCH).toBe('function');
  });

  it('accepts baseUrl with trailing slash', () => {
    expect(() =>
      createApiClient<Record<string, Record<string, unknown>>>({
        baseUrl: 'http://localhost:8080/',
      }),
    ).not.toThrow();
  });
});
