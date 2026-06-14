import { describe, it, expect } from 'vitest';
import {
	DEFAULT_LOADER_FILE,
	UnknownPlatformError,
	buildEmulatorConfig,
	injectEmulatorScript,
	type InjectableScript,
	type MinimalDocument,
} from '../src/loader.js';

describe('buildEmulatorConfig', () => {
	it('maps options onto EJS_* globals', () => {
		const { globals, core, player, dataPath, loaderUrl } = buildEmulatorConfig({
			core: 'super-nintendo',
			gameUrl: '/roms/zelda.sfc',
			gameName: 'Zelda',
		});
		expect(core).toBe('snes');
		expect(player).toBe('#game');
		expect(globals.EJS_core).toBe('snes');
		expect(globals.EJS_gameUrl).toBe('/roms/zelda.sfc');
		expect(globals.EJS_gameName).toBe('Zelda');
		expect(globals.EJS_player).toBe('#game');
		expect(dataPath).toBe('/emulatorjs/data/');
		expect(loaderUrl).toBe(`/emulatorjs/data/${DEFAULT_LOADER_FILE}`);
	});

	it('normalises a dataPath missing its trailing slash', () => {
		const { dataPath, loaderUrl, globals } = buildEmulatorConfig({
			core: 'nes',
			gameUrl: '/g.nes',
			dataPath: 'https://cdn.x/data',
		});
		expect(dataPath).toBe('https://cdn.x/data/');
		expect(loaderUrl).toBe('https://cdn.x/data/loader.js');
		expect(globals.EJS_pathtodata).toBe('https://cdn.x/data/');
	});

	it('respects a custom player selector', () => {
		const { player, globals } = buildEmulatorConfig({
			core: 'gba',
			gameUrl: '/g.gba',
			player: '#retro',
		});
		expect(player).toBe('#retro');
		expect(globals.EJS_player).toBe('#retro');
	});

	it('includes biosUrl / language / color only when provided', () => {
		const bare = buildEmulatorConfig({ core: 'psx', gameUrl: '/g.bin' }).globals;
		expect('EJS_biosUrl' in bare).toBe(false);
		expect('EJS_language' in bare).toBe(false);
		expect('EJS_color' in bare).toBe(false);

		const full = buildEmulatorConfig({
			core: 'psx',
			gameUrl: '/g.bin',
			biosUrl: '/bios/scph.bin',
			language: 'en-US',
			color: '00bcd4',
		}).globals;
		expect(full.EJS_biosUrl).toBe('/bios/scph.bin');
		expect(full.EJS_language).toBe('en-US');
		expect(full.EJS_color).toBe('00bcd4');
	});

	it('defaults startOnLoad false and gamepad true', () => {
		const { globals } = buildEmulatorConfig({ core: 'nes', gameUrl: '/g.nes' });
		expect(globals.EJS_startOnLoaded).toBe(false);
		expect(globals.EJS_Buttons).toEqual({ gamepad: true });
	});

	it('disables gamepad and start-on-load when requested', () => {
		const { globals } = buildEmulatorConfig({
			core: 'nes',
			gameUrl: '/g.nes',
			gamepad: false,
			startOnLoad: true,
		});
		expect(globals.EJS_startOnLoaded).toBe(true);
		expect(globals.EJS_Buttons).toEqual({ gamepad: false });
	});

	it('turns off save-state slot when saveState is false', () => {
		const on = buildEmulatorConfig({ core: 'nes', gameUrl: '/g.nes' }).globals;
		expect(on.EJS_defaultOptions).toEqual({ 'save-state-slot': '1' });
		const off = buildEmulatorConfig({
			core: 'nes',
			gameUrl: '/g.nes',
			saveState: false,
		}).globals;
		expect(off.EJS_defaultOptions).toEqual({ 'save-state-slot': 'off' });
	});

	it('merges extra overrides, prefixing bare keys with EJS_', () => {
		const { globals } = buildEmulatorConfig({
			core: 'nes',
			gameUrl: '/g.nes',
			extra: { volume: 0.5, EJS_threads: true },
		});
		expect(globals.EJS_volume).toBe(0.5);
		expect(globals.EJS_threads).toBe(true);
	});

	it('throws UnknownPlatformError for an unknown core', () => {
		expect(() => buildEmulatorConfig({ core: 'dreamcast', gameUrl: '/g' })).toThrow(
			UnknownPlatformError,
		);
		try {
			buildEmulatorConfig({ core: 'dreamcast', gameUrl: '/g' });
		} catch (err) {
			expect(err).toBeInstanceOf(UnknownPlatformError);
			expect((err as UnknownPlatformError).slug).toBe('dreamcast');
		}
	});
});

// --- Fake DOM for injectEmulatorScript --------------------------------------

class FakeScript implements InjectableScript {
	src = '';
	async = false;
	id = '';
	parentNode: { removeChild(node: unknown): unknown } | null = null;
}

class FakeElement {
	children: FakeScript[] = [];
	appendChild(node: unknown): unknown {
		const script = node as FakeScript;
		script.parentNode = this;
		this.children.push(script);
		return node;
	}
	removeChild(node: unknown): unknown {
		const script = node as FakeScript;
		this.children = this.children.filter((c) => c !== script);
		script.parentNode = null;
		return node;
	}
}

function makeDoc(): { doc: MinimalDocument; body: FakeElement } {
	const body = new FakeElement();
	const byId = new Map<string, FakeScript>();
	const doc: MinimalDocument = {
		createElement: (): FakeScript => new FakeScript(),
		getElementById: (id: string) => byId.get(id) ?? null,
		head: null,
		body,
	};
	// Index appended scripts by id so re-mount removal can find a prior loader.
	const realAppend = body.appendChild.bind(body);
	body.appendChild = (node: unknown): unknown => {
		const s = node as FakeScript;
		const res = realAppend(s);
		if (s.id) byId.set(s.id, s);
		return res;
	};
	return { doc, body };
}

describe('injectEmulatorScript', () => {
	it('sets the loader script src and inserts it', () => {
		const { doc, body } = makeDoc();
		const win: Record<string, unknown> = {};
		const { script, config } = injectEmulatorScript(
			{ core: 'snes', gameUrl: '/roms/z.sfc', dataPath: '/ejs/data' },
			{ document: doc, window: win },
		);
		expect(script.src).toBe('/ejs/data/loader.js');
		expect(script.async).toBe(true);
		expect(body.children).toContain(script);
		expect(config.core).toBe('snes');
	});

	it('writes every EJS_* global onto the injected window', () => {
		const { doc } = makeDoc();
		const win: Record<string, unknown> = {};
		injectEmulatorScript(
			{ core: 'gba', gameUrl: '/g.gba', gameName: 'Metroid' },
			{ document: doc, window: win },
		);
		expect(win.EJS_core).toBe('gba');
		expect(win.EJS_gameUrl).toBe('/g.gba');
		expect(win.EJS_gameName).toBe('Metroid');
		expect(win.EJS_player).toBe('#game');
	});

	it('cleanup removes the script and clears the globals', () => {
		const { doc, body } = makeDoc();
		const win: Record<string, unknown> = { preexisting: 1 };
		const { cleanup } = injectEmulatorScript(
			{ core: 'nes', gameUrl: '/g.nes' },
			{ document: doc, window: win },
		);
		expect(body.children.length).toBe(1);
		expect(win.EJS_core).toBe('nes');
		cleanup();
		expect(body.children.length).toBe(0);
		expect('EJS_core' in win).toBe(false);
		// unrelated globals untouched
		expect(win.preexisting).toBe(1);
	});

	it('removes a prior loader script on re-mount (no duplicate stacking)', () => {
		const { doc, body } = makeDoc();
		const win: Record<string, unknown> = {};
		injectEmulatorScript({ core: 'nes', gameUrl: '/a.nes' }, { document: doc, window: win });
		injectEmulatorScript({ core: 'snes', gameUrl: '/b.sfc' }, { document: doc, window: win });
		expect(body.children.length).toBe(1);
		expect(win.EJS_core).toBe('snes');
	});

	it('falls back to <head> when <body> is null', () => {
		const head = new FakeElement();
		const byId = new Map<string, FakeScript>();
		const realAppend = head.appendChild.bind(head);
		head.appendChild = (node: unknown): unknown => {
			const s = node as FakeScript;
			const res = realAppend(s);
			if (s.id) byId.set(s.id, s);
			return res;
		};
		const doc: MinimalDocument = {
			createElement: () => new FakeScript(),
			getElementById: (id: string) => byId.get(id) ?? null,
			head,
			body: null,
		};
		injectEmulatorScript({ core: 'nes', gameUrl: '/g.nes' }, { document: doc, window: {} });
		expect(head.children.length).toBe(1);
	});

	it('throws when the document has neither body nor head', () => {
		const doc: MinimalDocument = {
			createElement: () => new FakeScript(),
			getElementById: () => null,
			head: null,
			body: null,
		};
		expect(() =>
			injectEmulatorScript({ core: 'nes', gameUrl: '/g.nes' }, { document: doc, window: {} }),
		).toThrow(/no <body> or <head>/);
	});
});
