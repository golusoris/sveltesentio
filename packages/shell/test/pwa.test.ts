import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { registerSW as RegisterSW } from '../src/pwa';

// ---------------------------------------------------------------------------
// `registerSW` resolves `virtual:pwa-register` lazily so the PWA plugin stays
// an optional peer. We exercise three branches without a real service worker:
//   1. SSR (no `window`)          → no-op updater, virtual module never touched.
//   2. plugin configured          → delegates to the virtual `registerSW`.
//   3. plugin absent (import throws) → warns + returns a no-op updater.
//
// `vi.doMock` + `vi.resetModules` lets each test pick the virtual-module state
// before dynamically importing the unit under test.
// ---------------------------------------------------------------------------

const VIRTUAL = 'virtual:pwa-register';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	vi.doUnmock(VIRTUAL);
	vi.restoreAllMocks();
});

async function loadRegisterSW(): Promise<typeof RegisterSW> {
	const mod = await import('../src/pwa');
	return mod.registerSW;
}

describe('registerSW — SSR', () => {
	beforeEach(() => {
		vi.stubGlobal('window', undefined);
	});

	it('returns a no-op updater and never imports the virtual module', async () => {
		const virtualRegister = vi.fn();
		vi.doMock(VIRTUAL, () => ({ registerSW: virtualRegister }));

		const registerSW = await loadRegisterSW();
		const update = await registerSW({ immediate: true });

		expect(typeof update).toBe('function');
		await expect(update()).resolves.toBeUndefined();
		expect(virtualRegister).not.toHaveBeenCalled();
	});
});

describe('registerSW — plugin configured', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {});
	});

	it('delegates to the virtual registerSW and returns its updater', async () => {
		const update = vi.fn().mockResolvedValue(undefined);
		const virtualRegister = vi.fn().mockReturnValue(update);
		vi.doMock(VIRTUAL, () => ({ registerSW: virtualRegister }));

		const registerSW = await loadRegisterSW();
		const options = { immediate: true, onNeedRefresh: () => {} };
		const result = await registerSW(options);

		expect(virtualRegister).toHaveBeenCalledExactlyOnceWith(options);
		expect(result).toBe(update);

		await result(true);
		expect(update).toHaveBeenCalledExactlyOnceWith(true);
	});

	it('defaults options to an empty object when called with no argument', async () => {
		const virtualRegister = vi.fn().mockReturnValue(async () => {});
		vi.doMock(VIRTUAL, () => ({ registerSW: virtualRegister }));

		const registerSW = await loadRegisterSW();
		await registerSW();

		expect(virtualRegister).toHaveBeenCalledExactlyOnceWith({});
	});
});

describe('registerSW — plugin absent', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {});
	});

	it('warns and returns a no-op updater when the virtual import rejects', async () => {
		vi.doMock(VIRTUAL, () => {
			throw new Error('Failed to resolve import "virtual:pwa-register"');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const registerSW = await loadRegisterSW();
		const update = await registerSW();

		expect(typeof update).toBe('function');
		await expect(update()).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		// The catch logs the prefixed message plus the underlying import error.
		const call: unknown[] = warn.mock.calls[0] ?? [];
		const [message, loggedError] = call;
		expect(String(message)).toContain('virtual:pwa-register unavailable');
		expect(loggedError).toBeInstanceOf(Error);
	});

	it('returns a no-op updater that ignores its reloadPage argument', async () => {
		vi.doMock(VIRTUAL, () => {
			throw new Error('unresolved');
		});
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const registerSW = await loadRegisterSW();
		const update = await registerSW();

		await expect(update(true)).resolves.toBeUndefined();
		await expect(update(false)).resolves.toBeUndefined();
	});
});
