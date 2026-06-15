import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LangSync from '../src/LangSync.svelte';

// The announcer's live region (`#sentio-a11y-announcer`) is appended to
// `document.body` and persists across renders; reset both it and the document
// element's lang/dir between cases so assertions start from a known baseline.
afterEach(() => {
	document.body.innerHTML = '';
	document.documentElement.removeAttribute('lang');
	document.documentElement.removeAttribute('dir');
});

describe('<LangSync>', () => {
	it('renders no visible markup of its own', () => {
		const { container } = render(LangSync, { locale: 'en-US' });
		// Pure side-effect component: it emits no element/text markup. Svelte 5
		// leaves a single empty mount anchor in the container, so assert on the
		// rendered HTML being empty rather than on child-node count.
		expect(container.innerHTML).toBe('');
	});

	it('sets <html lang> and ltr dir for a left-to-right locale', () => {
		render(LangSync, { locale: 'de-AT' });
		expect(document.documentElement.lang).toBe('de-AT');
		expect(document.documentElement.dir).toBe('ltr');
	});

	it('sets rtl dir for a right-to-left locale (Arabic)', () => {
		render(LangSync, { locale: 'ar' });
		expect(document.documentElement.lang).toBe('ar');
		expect(document.documentElement.dir).toBe('rtl');
	});

	it('detects rtl from an explicit script subtag (e.g. ku-Arab)', () => {
		render(LangSync, { locale: 'ku-Arab' });
		expect(document.documentElement.dir).toBe('rtl');
	});

	it('re-syncs lang and dir when the locale prop changes', async () => {
		const { rerender } = render(LangSync, { locale: 'en-US' });
		expect(document.documentElement.lang).toBe('en-US');
		expect(document.documentElement.dir).toBe('ltr');

		await rerender({ locale: 'he' });
		expect(document.documentElement.lang).toBe('he');
		expect(document.documentElement.dir).toBe('rtl');
	});

	it('announces the language change through the aria-live region', async () => {
		render(LangSync, { locale: 'fr-FR' });

		const region = document.getElementById('sentio-a11y-announcer');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('aria-live')).toBe('polite');
		expect(region?.getAttribute('role')).toBe('status');

		// announceNavigation writes the message in a queued microtask.
		await Promise.resolve();
		expect(region?.textContent).toBe('Language changed to fr-FR');
	});

	it('uses a custom announce callback when supplied', async () => {
		render(LangSync, {
			locale: 'ja-JP',
			announce: (locale: string) => `Sprache: ${locale}`,
		});

		await Promise.resolve();
		const region = document.getElementById('sentio-a11y-announcer');
		expect(region?.textContent).toBe('Sprache: ja-JP');
	});

	it('suppresses the announcement when the callback returns null', async () => {
		render(LangSync, {
			locale: 'es-ES',
			announce: () => null,
		});

		await Promise.resolve();
		// No announcer region is created when nothing is announced.
		expect(document.getElementById('sentio-a11y-announcer')).toBeNull();
		// lang/dir are still synced regardless of the announcement decision.
		expect(document.documentElement.lang).toBe('es-ES');
	});

	it('keeps the live region a single reused element across locale changes', async () => {
		const { rerender } = render(LangSync, { locale: 'en' });
		await Promise.resolve();
		await rerender({ locale: 'de' });
		await Promise.resolve();
		expect(document.querySelectorAll('#sentio-a11y-announcer')).toHaveLength(1);
	});
});
