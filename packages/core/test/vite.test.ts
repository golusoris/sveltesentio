import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sentioPlugin } from '../src/vite';

const originalEnv = { ...process.env };

describe('sentioPlugin', () => {
	beforeEach(() => {
		for (const k of Object.keys(process.env)) {
			if (!(k in originalEnv)) delete process.env[k];
		}
		Object.assign(process.env, originalEnv);
	});

	afterEach(() => {
		for (const k of Object.keys(process.env)) {
			if (!(k in originalEnv)) delete process.env[k];
		}
		Object.assign(process.env, originalEnv);
	});

	it('returns a pre-enforced plugin', () => {
		const p = sentioPlugin();
		expect(p.name).toBe('vite-plugin-sentio');
		expect(p.enforce).toBe('pre');
	});

	it('buildStart throws on missing required env', () => {
		const p = sentioPlugin({ requiredEnv: ['NEVER_SET_FOO'] });
		delete process.env.NEVER_SET_FOO;
		const fn = p.buildStart;
		const bs = typeof fn === 'function' ? fn : fn?.handler;
		expect(() => bs?.call(null as never, {} as never)).toThrow(/NEVER_SET_FOO/);
	});

	it('buildStart passes when required env present', () => {
		const p = sentioPlugin({ requiredEnv: ['SENTIO_TEST_OK'] });
		process.env.SENTIO_TEST_OK = 'yes';
		const fn = p.buildStart;
		const bs = typeof fn === 'function' ? fn : fn?.handler;
		expect(() => bs?.call(null as never, {} as never)).not.toThrow();
	});

	it('resolves the $sentio virtual module', () => {
		const p = sentioPlugin({ virtualModule: { appName: 'demo' } });
		const resolve = p.resolveId;
		const resolver = typeof resolve === 'function' ? resolve : resolve?.handler;
		const resolved = resolver?.call(null as never, '$sentio', undefined as never, {} as never);
		expect(resolved).toBe('\0$sentio');
	});

	it('returns undefined when resolving an unrelated id', () => {
		const p = sentioPlugin();
		const resolve = p.resolveId;
		const resolver = typeof resolve === 'function' ? resolve : resolve?.handler;
		const resolved = resolver?.call(
			null as never,
			'some-other-module',
			undefined as never,
			{} as never,
		);
		expect(resolved).toBeUndefined();
	});

	it('returns undefined from load for an unrelated id', () => {
		const p = sentioPlugin({ virtualModule: { x: 1 } });
		const load = p.load;
		const loader = typeof load === 'function' ? load : load?.handler;
		const code = loader?.call(null as never, 'not-sentio', {} as never);
		expect(code).toBeUndefined();
	});

	it('logs the resolved config when verbose is enabled', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const p = sentioPlugin({ verbose: true });
			const fn = p.configResolved;
			const cr = typeof fn === 'function' ? fn : fn?.handler;
			cr?.call(null as never, {
				mode: 'production',
				root: '/app',
				build: { outDir: 'dist', ssr: true },
			} as never);
			expect(warn).toHaveBeenCalledWith(
				'[sentio] Resolved Vite config:',
				expect.objectContaining({ mode: 'production', root: '/app' }),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('does not log when verbose is disabled', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const p = sentioPlugin({ verbose: false });
			const fn = p.configResolved;
			const cr = typeof fn === 'function' ? fn : fn?.handler;
			cr?.call(null as never, {
				mode: 'development',
				root: '/app',
				build: { outDir: 'dist', ssr: false },
			} as never);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it('loads the $sentio virtual module with frozen default export', () => {
		const p = sentioPlugin({ virtualModule: { appName: 'demo', port: 3000 } });
		const load = p.load;
		const loader = typeof load === 'function' ? load : load?.handler;
		const code = loader?.call(null as never, '\0$sentio', {} as never) as string;
		expect(code).toContain('export const appName = "demo";');
		expect(code).toContain('export const port = 3000;');
		expect(code).toContain('Object.freeze');
	});
});
