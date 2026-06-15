import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Emulator from '../src/Emulator.svelte';
import { expectNoAxeViolations } from './axe-helper.js';

// The loader id `<Emulator>`'s effect injects under, mirrored from
// loader.ts' private SCRIPT_ID so the test can assert the browser-only wiring
// without exporting an internal constant.
const SCRIPT_ID = 'sveltesentio-emulatorjs-loader';

// `EJS_*` globals the injection writes onto `window`. Tracked so each case can
// assert the browser seam fired and clear any residue the unmount missed.
const EJS_KEYS = [
	'EJS_player',
	'EJS_core',
	'EJS_gameUrl',
	'EJS_pathtodata',
	'EJS_startOnLoaded',
	'EJS_Buttons',
	'EJS_defaultOptions',
	'EJS_disableDatabases',
] as const;

function clearEjsGlobals(): void {
	const win = globalThis as unknown as Record<string, unknown>;
	for (const key of Object.keys(win)) {
		if (key.startsWith('EJS_')) delete win[key];
	}
	const prior = document.getElementById(SCRIPT_ID);
	if (prior) prior.remove();
}

beforeEach(() => {
	clearEjsGlobals();
});

afterEach(() => {
	clearEjsGlobals();
});

describe('<Emulator>', () => {
	it('renders the application mount region with the default id and accessible name', () => {
		render(Emulator, { core: 'snes', gameUrl: '/roms/zelda.sfc' });

		const region = screen.getByRole('application', { name: 'Game emulator' });
		expect(region).toBeInTheDocument();
		expect(region).toHaveAttribute('id', 'sveltesentio-emulator');
		expect(region).toHaveClass('ssentio-emulator');
	});

	it('honours a custom mountId and label', () => {
		render(Emulator, {
			core: 'gba',
			gameUrl: '/roms/metroid.gba',
			mountId: 'retro-stage',
			label: 'Metroid Fusion',
		});

		const region = screen.getByRole('application', { name: 'Metroid Fusion' });
		expect(region).toHaveAttribute('id', 'retro-stage');
	});

	it('does not crash when mounting: the browser-only loader effect runs and injects the loader script', () => {
		render(Emulator, { core: 'snes', gameUrl: '/roms/zelda.sfc' });

		// The BROWSER-guarded `$effect` resolves true under the jsdom/browser
		// project, so `injectEmulatorScript` ran against jsdom's real document and
		// appended exactly one loader <script> with the conventional id + src.
		const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
		expect(script).not.toBeNull();
		expect(script?.tagName).toBe('SCRIPT');
		expect(script?.src).toContain('/emulatorjs/data/loader.js');
		expect(script?.async).toBe(true);
	});

	it('targets the mount element via EJS_player and writes the resolved EJS_* globals', () => {
		render(Emulator, {
			core: 'super-nintendo',
			gameUrl: '/roms/zelda.sfc',
			mountId: 'retro-stage',
		});

		const win = globalThis as unknown as Record<string, unknown>;
		// EJS_player is wired to the `#${mountId}` selector the component owns.
		expect(win.EJS_player).toBe('#retro-stage');
		// The platform slug was resolved to its EmulatorJS core id.
		expect(win.EJS_core).toBe('snes');
		expect(win.EJS_gameUrl).toBe('/roms/zelda.sfc');
		expect(win.EJS_pathtodata).toBe('/emulatorjs/data/');
	});

	it('forwards extra config props through the loader (custom dataPath + gameName)', () => {
		render(Emulator, {
			core: 'nes',
			gameUrl: '/roms/smb.nes',
			dataPath: 'https://cdn.example/ejs/data',
			gameName: 'Super Mario Bros.',
		});

		const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
		expect(script?.src).toContain('https://cdn.example/ejs/data/loader.js');

		const win = globalThis as unknown as Record<string, unknown>;
		expect(win.EJS_pathtodata).toBe('https://cdn.example/ejs/data/');
		expect(win.EJS_gameName).toBe('Super Mario Bros.');
	});

	it('tears down the loader script and clears the EJS_* globals on unmount', () => {
		const { unmount } = render(Emulator, { core: 'snes', gameUrl: '/roms/zelda.sfc' });

		expect(document.getElementById(SCRIPT_ID)).not.toBeNull();
		const win = globalThis as unknown as Record<string, unknown>;
		expect(win.EJS_core).toBe('snes');

		unmount();

		// The effect's returned cleanup removed the script and every global it set.
		expect(document.getElementById(SCRIPT_ID)).toBeNull();
		for (const key of EJS_KEYS) {
			expect(key in win).toBe(false);
		}
	});

	it('does not stack duplicate loader scripts across re-render', async () => {
		const { rerender } = render(Emulator, { core: 'nes', gameUrl: '/a.nes' });

		await rerender({ core: 'snes', gameUrl: '/b.sfc' });

		// `injectEmulatorScript` is idempotent on its script id, so a re-mount
		// removes the prior loader before appending the new one.
		const scripts = document.querySelectorAll(`#${SCRIPT_ID}`);
		expect(scripts.length).toBe(1);
	});

	it('is axe-clean on the rendered application shell', async () => {
		const { container } = render(Emulator, {
			core: 'snes',
			gameUrl: '/roms/zelda.sfc',
			label: 'Retro game emulator',
		});
		await expectNoAxeViolations(container);
	});
});
