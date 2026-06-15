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

	it('throws a "public" EnvValidationError when only the public schema fails', () => {
		try {
			createEnv({
				server: z.object({ A: z.string() }),
				publicEnv: z.object({ PUBLIC_X: z.string() }),
				runtimeEnv: { A: 'ok' }, // PUBLIC_X missing → public parse fails
			});
			throw new Error('expected createEnv to throw');
		} catch (err) {
			expect(err).toBeInstanceOf(EnvValidationError);
			expect((err as EnvValidationError).message).toContain('Invalid public environment');
		}
	});
});

describe('EnvValidationError', () => {
	it('carries the treeified error on .tree', () => {
		const tree = { errors: ['boom'] };
		const err = new EnvValidationError('server', tree);
		expect(err.name).toBe('EnvValidationError');
		expect(err.tree).toBe(tree);
		expect(err.message).toContain('Invalid server environment');
	});

	it('falls back to "[unserialisable tree]" when the tree cannot be JSON-stringified', () => {
		const circular: Record<string, unknown> = {};
		circular['self'] = circular; // JSON.stringify throws on circular refs
		const err = new EnvValidationError('public', circular);
		expect(err.message).toContain('[unserialisable tree]');
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
