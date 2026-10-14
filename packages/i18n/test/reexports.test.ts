import { describe, expect, it } from 'vitest';
import { paraglideVitePlugin } from '../src/index.js';
import { paraglideVitePlugin as upstreamParaglideVitePlugin } from '@inlang/paraglide-js';

describe('i18n re-exports (append-only API, HISS-14)', () => {
	it('re-exports paraglideVitePlugin identical to upstream @inlang/paraglide-js export', () => {
		expect(paraglideVitePlugin).toBeDefined();
		expect(typeof paraglideVitePlugin).toBe('function');
		expect(paraglideVitePlugin).toBe(upstreamParaglideVitePlugin);
	});

	it('produces a configured Vite plugin instance when invoked', () => {
		const plugin = paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/paraglide',
		});
		expect(plugin).toBeDefined();
		// unplugin returns single plugin or array of plugins
		const pluginName = Array.isArray(plugin) ? plugin[0]?.name : (plugin as { name?: string }).name;
		expect(pluginName).toBe('unplugin-paraglide-js');
	});

	it('boundary/negative: paraglideVitePlugin does not match arbitrary functions', () => {
		const dummyFn = () => {};
		expect(paraglideVitePlugin).not.toBe(dummyFn);
		expect(paraglideVitePlugin).not.toBeNull();
		expect(paraglideVitePlugin).not.toBeUndefined();
	});
});
