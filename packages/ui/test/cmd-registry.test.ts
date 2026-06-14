import { describe, it, expect, vi } from 'vitest';
import {
	CommandRegistry,
	scoreCommand,
	searchCommands,
	type Command,
} from '../src/cmd/registry.js';

function cmd(id: string, title: string, extra: Partial<Command> = {}): Command {
	return { id, title, run: () => {}, ...extra };
}

const commands: Command[] = [
	cmd('open-settings', 'Open Settings', { keywords: ['preferences', 'config'] }),
	cmd('new-file', 'New File', { subtitle: 'Create a blank document' }),
	cmd('toggle-theme', 'Toggle Theme', { group: 'Appearance' }),
	cmd('search-files', 'Search Files'),
];

describe('scoreCommand', () => {
	it('empty query matches everything with a baseline score', () => {
		expect(scoreCommand(commands[0]!, '')).toBe(1);
	});

	it('ranks exact > prefix > substring on the title', () => {
		const exact = scoreCommand(cmd('a', 'new file'), 'new file');
		const prefix = scoreCommand(cmd('a', 'New File Wizard'), 'new');
		const sub = scoreCommand(cmd('a', 'Create New File'), 'new');
		expect(exact).toBeGreaterThan(prefix);
		expect(prefix).toBeGreaterThan(sub);
	});

	it('matches keywords and subtitles below title hits', () => {
		const titleHit = scoreCommand(commands[0]!, 'open');
		const keywordHit = scoreCommand(commands[0]!, 'preferences');
		const subtitleHit = scoreCommand(commands[1]!, 'blank');
		expect(titleHit).toBeGreaterThan(keywordHit);
		expect(keywordHit).toBeGreaterThan(0);
		expect(subtitleHit).toBeGreaterThan(0);
	});

	it('falls back to a fuzzy subsequence match', () => {
		// "stng" is a subsequence of "settings".
		expect(scoreCommand(cmd('a', 'Settings'), 'stng')).toBeGreaterThan(0);
		expect(scoreCommand(cmd('a', 'Settings'), 'zzz')).toBe(0);
	});
});

describe('searchCommands', () => {
	it('drops non-matches and ranks the rest', () => {
		const results = searchCommands(commands, 'file');
		const ids = results.map((r) => r.command.id);
		expect(ids).toContain('new-file');
		expect(ids).toContain('search-files');
		expect(ids).not.toContain('toggle-theme');
	});

	it('is stable for equal scores (insertion order)', () => {
		const a = cmd('a', 'Zebra');
		const b = cmd('b', 'Zebra');
		const results = searchCommands([a, b], 'zebra');
		expect(results.map((r) => r.command.id)).toEqual(['a', 'b']);
	});

	it('empty query returns all in insertion order', () => {
		const results = searchCommands(commands, '');
		expect(results.map((r) => r.command.id)).toEqual(commands.map((c) => c.id));
	});
});

describe('CommandRegistry', () => {
	it('register returns a new registry without mutating the original', () => {
		const empty = new CommandRegistry();
		const one = empty.register(commands[0]!);
		expect(empty.commands).toHaveLength(0);
		expect(one.commands).toHaveLength(1);
		expect(one.get('open-settings')).toBe(commands[0]);
	});

	it('register replaces by id', () => {
		const r = new CommandRegistry().register(cmd('x', 'First')).register(cmd('x', 'Second'));
		expect(r.commands).toHaveLength(1);
		expect(r.get('x')?.title).toBe('Second');
	});

	it('unregister removes by id and is a no-op when absent', () => {
		const r = new CommandRegistry().register(...commands);
		const without = r.unregister('new-file');
		expect(without.get('new-file')).toBeUndefined();
		expect(without.unregister('missing')).toBe(without);
	});

	it('search delegates to searchCommands', () => {
		const r = new CommandRegistry().register(...commands);
		expect(r.search('theme').map((x) => x.command.id)).toEqual(['toggle-theme']);
	});

	it('preserves the run callback for execution', async () => {
		const run = vi.fn();
		const r = new CommandRegistry().register(cmd('run-me', 'Run Me', { run }));
		await r.get('run-me')?.run();
		expect(run).toHaveBeenCalledOnce();
	});
});
