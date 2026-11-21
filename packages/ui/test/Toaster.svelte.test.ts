// Component-render tests verifying that `toastPreset(...).toaster` delivers
// preset sizing, centring, stacking gap, viewport offset, and action button
// target-size floor to a real mounted `svelte-sonner` `<Toaster>` (ADR-0016, #643).
import { render } from '@testing-library/svelte';
import { Toaster, toast } from 'svelte-sonner';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toastPreset } from '../src/toast/index.js';

/** Poll boundedly (<= 20 ticks, 10 ms each) for a mounted `[data-sonner-toast]`. */
async function waitForToast(container: HTMLElement): Promise<HTMLElement | null> {
	for (let tick = 0; tick < 20; tick += 1) {
		const el = container.querySelector<HTMLElement>('[data-sonner-toast]');
		if (el !== null) return el;
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 10);
		});
	}
	return container.querySelector<HTMLElement>('[data-sonner-toast]');
}

describe('<Toaster {...toastPreset().toaster}>', () => {
	let originalMatchMedia: typeof window.matchMedia;

	beforeEach(() => {
		originalMatchMedia = window.matchMedia;
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			writable: true,
			value: (query: string): MediaQueryList => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: () => undefined,
				removeListener: () => undefined,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				dispatchEvent: () => false,
			}),
		});
	});

	afterEach(() => {
		toast.dismiss();
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			writable: true,
			value: originalMatchMedia,
		});
	});

	it('applies 10foot width, padding, font-size, centring, gap, offset and button target floor on a mounted toast', async () => {
		const p = toastPreset('10foot');
		const { container, unmount } = render(Toaster, { ...p.toaster });
		const id = toast('probe', {
			action: {
				label: 'Undo',
				onClick: () => undefined,
			},
		});

		const li = await waitForToast(container);
		expect(li).not.toBeNull();
		const liStyle = li?.getAttribute('style') ?? '';
		expect(liStyle).toContain('--width: 40rem');
		expect(liStyle).toContain('padding: 1.125rem 1.5rem');
		expect(liStyle).toContain('font-size: 20px');
		expect(liStyle).toContain('translate: -50% 0');
		expect(liStyle).not.toContain(' undefined');

		const button = container.querySelector<HTMLElement>('[data-button]');
		expect(button).not.toBeNull();
		expect(button?.getAttribute('style') ?? '').toContain('min-height: 44px');

		const ol = container.querySelector<HTMLElement>('[data-sonner-toaster]');
		expect(ol).not.toBeNull();
		const olStyle = ol?.getAttribute('style') ?? '';
		expect(olStyle).toContain('--gap: 18px');
		expect(olStyle).toContain('1.5rem');

		toast.dismiss(id);
		unmount();
	});

	it('drops preset width when the object style map is passed directly to toastOptions.style', async () => {
		const p = toastPreset('10foot');
		const { container, unmount } = render(Toaster, {
			position: p.position,
			toastOptions: {
				// Cast reproduces why the pre-#643 path (`toastOptions={{ style: p.style }}`)
				// failed at runtime: svelte-sonner expects a semicolon-terminated style string
				// and drops the object map.
				style: p.style as unknown as string,
			},
		});
		const id = toast('probe', {
			action: {
				label: 'Undo',
				onClick: () => undefined,
			},
		});

		const li = await waitForToast(container);
		expect(li).not.toBeNull();
		expect(li?.getAttribute('style') ?? '').not.toContain('--width: 40rem');

		toast.dismiss(id);
		unmount();
	});
});
