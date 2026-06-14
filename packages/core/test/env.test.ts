import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, createEnv, requireEnv } from '../src/env';

describe('createEnv', () => {
	it('merges server + public values', () => {
		const env = createEnv({
			server: z.object({ DATABASE_URL: z.string() }),
			publicEnv: z.object({ PUBLIC_API: z.string().url() }),
			runtimeEnv: {
				DATABASE_URL: 'postgres://localhost/x',
				PUBLIC_API: 'https://example.test',
			},
		});
		expect(env.DATABASE_URL).toBe('postgres://localhost/x');
		expect(env.PUBLIC_API).toBe('https://example.test');
	});

	it('throws EnvValidationError with tree on invalid server env', () => {
		expect(() =>
			createEnv({
				server: z.object({ PORT: z.coerce.number().int().positive() }),
				publicEnv: z.object({}),
				runtimeEnv: { PORT: 'not-a-number' },
			}),
		).toThrow(EnvValidationError);
	});

	it('freezes the result', () => {
		const env = createEnv({
			server: z.object({ A: z.string() }),
			publicEnv: z.object({}),
			runtimeEnv: { A: 'x' },
		});
		expect(() => {
			(env as { A: string }).A = 'y';
		}).toThrow();
	});

	it('skipValidation bypasses parsing', () => {
		const env = createEnv({
			server: z.object({ NOPE: z.string() }),
			publicEnv: z.object({}),
			runtimeEnv: {},
			skipValidation: true,
		});
		expect(env).toEqual({});
	});
});

describe('requireEnv', () => {
	it('returns the value when set', () => {
		expect(requireEnv('X', 'value')).toBe('value');
	});

	it('throws on undefined or empty', () => {
		expect(() => requireEnv('X', undefined)).toThrow(EnvValidationError);
		expect(() => requireEnv('X', '')).toThrow(EnvValidationError);
	});
});
