import { describe, it, expect, vi } from 'vitest';
import { dashboardCss, buildCommandRegistry, searchPalette } from '../src/client-dashboard.js';
import type { Command } from '@sveltesentio/ui/cmd';

function cmd(id: string, title: string, extra?: Partial<Command>): Command {
	return { id, title, run: () => {}, ...extra };
}

describe('ui tokens + presets composition', () => {
	it('emits theme + interface CSS for a chosen interface type', () => {
		const css = dashboardCss('handheld');
		expect(css).toContain(':root');
		expect(css).toContain('--color-background');
		// Handheld preset bakes the 44px WCAG 2.2 target-size floor.
		expect(css).toContain('--ui-min-target-size: 44px');
		// oklch-only tokens (ADR-0006): no hsl fallbacks leak in.
		expect(css).toContain('oklch(');
		expect(css).not.toContain('hsl(');
	});

	it('selects the dense dashboard preset for data-heavy surfaces', () => {
		const css = dashboardCss('dashboard');
		expect(css).toContain('--ui-control-height: 2rem');
	});
});

describe('ui command registry composition', () => {
	it('search finds a command by title and ranks exact over fuzzy', () => {
		const registry = buildCommandRegistry([
			cmd('open-settings', 'Open Settings'),
			cmd('open-search', 'Open Search'),
			cmd('logout', 'Log out'),
		]);
		const ranked = searchPalette(registry, 'open s');
		expect(ranked.length).toBeGreaterThanOrEqual(2);
		expect(ranked[0]?.command.title.toLowerCase().startsWith('open s')).toBe(true);
	});

	it('matches via keyword aliases', () => {
		const registry = buildCommandRegistry([
			cmd('toggle-theme', 'Toggle Theme', { keywords: ['dark', 'light', 'mode'] }),
		]);
		const ranked = searchPalette(registry, 'dark');
		expect(ranked).toHaveLength(1);
		expect(ranked[0]?.command.id).toBe('toggle-theme');
	});

	it('an empty query returns every command in insertion order', () => {
		const registry = buildCommandRegistry([cmd('a', 'Alpha'), cmd('b', 'Beta')]);
		const ranked = searchPalette(registry, '');
		expect(ranked.map((r) => r.command.id)).toEqual(['a', 'b']);
	});

	it('runs the selected command action', async () => {
		const run = vi.fn();
		const registry = buildCommandRegistry([cmd('save', 'Save', { run })]);
		await registry.get('save')?.run();
		expect(run).toHaveBeenCalledOnce();
	});
});
