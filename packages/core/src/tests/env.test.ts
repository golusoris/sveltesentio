import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createEnv, requireEnv } from '../env.js';
import { AppError } from '../errors.js';

describe('createEnv', () => {
  it('parses valid env', () => {
    const env = createEnv({
      server: z.object({ DATABASE_URL: z.string().url() }),
      public: z.object({ PUBLIC_API_URL: z.string().url() }),
      runtimeEnv: {
        DATABASE_URL: 'http://localhost:5432',
        PUBLIC_API_URL: 'http://localhost:3000',
      },
    });
    expect(env.DATABASE_URL).toBe('http://localhost:5432');
    expect(env.PUBLIC_API_URL).toBe('http://localhost:3000');
  });

  it('throws AppError on invalid server env', () => {
    expect(() =>
      createEnv({
        server: z.object({ DATABASE_URL: z.string().url() }),
        public: z.object({}),
        runtimeEnv: { DATABASE_URL: 'not-a-url' },
      }),
    ).toThrow(AppError);
  });

  it('throws AppError on missing required var', () => {
    expect(() =>
      createEnv({
        server: z.object({ SECRET_KEY: z.string().min(1) }),
        public: z.object({}),
        runtimeEnv: {},
      }),
    ).toThrow(AppError);
  });

  it('skips validation when skipValidation=true', () => {
    const env = createEnv({
      server: z.object({ DATABASE_URL: z.string().url() }),
      public: z.object({}),
      runtimeEnv: {},
      skipValidation: true,
    });
    expect(env).toBeDefined();
  });

  it('supports optional env vars with defaults', () => {
    const env = createEnv({
      server: z.object({ LOG_LEVEL: z.string().default('info') }),
      public: z.object({}),
      runtimeEnv: {},
    });
    expect(env.LOG_LEVEL).toBe('info');
  });
});

describe('requireEnv', () => {
  it('returns value when present', () => {
    expect(requireEnv('FOO', 'bar')).toBe('bar');
  });

  it('throws AppError when undefined', () => {
    expect(() => requireEnv('MISSING', undefined)).toThrow(AppError);
  });

  it('throws AppError when empty string', () => {
    expect(() => requireEnv('EMPTY', '')).toThrow(AppError);
  });
});
