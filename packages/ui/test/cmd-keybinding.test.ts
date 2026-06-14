import { describe, it, expect } from 'vitest';
import {
	matchesBinding,
	matchesShortcut,
	parseBinding,
	resolveKeymap,
	type KeyEventLike,
} from '../src/cmd/keybinding.js';

function event(key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...mods,
	};
}

describe('parseBinding', () => {
	it('parses modifiers and the key, order-insensitive', () => {
		expect(parseBinding('$mod+Shift+K')).toEqual({
			ctrl: false,
			meta: false,
			alt: false,
			shift: true,
			mod: true,
			key: 'k',
		});
		expect(parseBinding('K+Shift+$mod')).toEqual(parseBinding('$mod+Shift+K'));
	});

	it('resolves aliases (cmd/control/option)', () => {
		expect(parseBinding('Cmd+P').meta).toBe(true);
		expect(parseBinding('Control+P').ctrl).toBe(true);
		expect(parseBinding('Option+P').alt).toBe(true);
	});

	it('throws when there is no non-modifier key', () => {
		expect(() => parseBinding('$mod+Shift')).toThrow(/no non-modifier key/);
	});
});

describe('matchesBinding / matchesShortcut', () => {
	const binding = parseBinding('$mod+K');

	it('$mod resolves to Meta on Apple, Control elsewhere', () => {
		expect(matchesBinding(event('k', { metaKey: true }), binding, true)).toBe(true);
		expect(matchesBinding(event('k', { ctrlKey: true }), binding, true)).toBe(false);
		expect(matchesBinding(event('k', { ctrlKey: true }), binding, false)).toBe(true);
		expect(matchesBinding(event('k', { metaKey: true }), binding, false)).toBe(false);
	});

	it('requires an exact modifier set (no extra modifiers)', () => {
		expect(matchesBinding(event('k', { ctrlKey: true, shiftKey: true }), binding, false)).toBe(false);
	});

	it('is case-insensitive on the key', () => {
		expect(matchesShortcut(event('K', { ctrlKey: true }), '$mod+K', false)).toBe(true);
	});

	it('matches a punctuation key like "?"', () => {
		expect(matchesShortcut(event('?', { shiftKey: true }), 'Shift+?', false)).toBe(true);
	});

	it('rejects a different key', () => {
		expect(matchesShortcut(event('j', { ctrlKey: true }), '$mod+K', false)).toBe(false);
	});
});

describe('resolveKeymap', () => {
	const keymap = {
		'$mod+K': 'open-palette',
		'$mod+S': 'save',
		'Shift+?': 'help',
	};

	it('returns the command id for the first matching combo', () => {
		expect(resolveKeymap(event('k', { ctrlKey: true }), keymap, false)).toBe('open-palette');
		expect(resolveKeymap(event('s', { ctrlKey: true }), keymap, false)).toBe('save');
		expect(resolveKeymap(event('?', { shiftKey: true }), keymap, false)).toBe('help');
	});

	it('returns null when nothing matches', () => {
		expect(resolveKeymap(event('x'), keymap, false)).toBeNull();
	});
});
