import { afterEach, describe, expect, it } from 'vitest';
import {
	loadLocaleFont,
	type LocaleFontMap,
} from '../src/load-locale-font.js';

afterEach(() => {
	document.head.innerHTML = '';
});

const fonts: LocaleFontMap = {
	ja: [
		{ href: '/fonts/noto-jp.woff2', type: 'font/woff2' },
		{ href: '/fonts/noto-jp.css', rel: 'stylesheet' },
	],
	'ar-EG': [{ href: '/fonts/noto-ar.woff2', type: 'font/woff2' }],
};

function injectedLinks(): HTMLLinkElement[] {
	return Array.from(
		document.head.querySelectorAll<HTMLLinkElement>('link[data-sentio-locale-font]'),
	);
}

describe('loadLocaleFont — link creation', () => {
	it('injects preload + stylesheet links for the locale subset', () => {
		loadLocaleFont({ locale: 'ja-JP', fonts, document });
		const links = injectedLinks();
		expect(links).toHaveLength(2);

		const preload = links.find((l) => l.rel === 'preload');
		expect(preload?.getAttribute('href')).toBe('/fonts/noto-jp.woff2');
		expect(preload?.getAttribute('as')).toBe('font');
		expect(preload?.getAttribute('type')).toBe('font/woff2');
		expect(preload?.getAttribute('crossorigin')).toBe('anonymous');

		const stylesheet = links.find((l) => l.rel === 'stylesheet');
		expect(stylesheet?.getAttribute('href')).toBe('/fonts/noto-jp.css');
		expect(stylesheet?.getAttribute('as')).toBeNull();
	});

	it('resolves an exact tag before falling back to the language subtag', () => {
		loadLocaleFont({ locale: 'ar-EG', fonts, document });
		const links = injectedLinks();
		expect(links).toHaveLength(1);
		expect(links[0]?.getAttribute('href')).toBe('/fonts/noto-ar.woff2');
	});

	it('applies an SRI integrity hash when provided', () => {
		loadLocaleFont({
			locale: 'ko',
			fonts: { ko: [{ href: '/fonts/k.woff2', integrity: 'sha384-abc' }] },
			document,
		});
		expect(injectedLinks()[0]?.getAttribute('integrity')).toBe('sha384-abc');
	});

	it('does nothing for a locale with no mapped fonts', () => {
		const cleanup = loadLocaleFont({ locale: 'en-US', fonts, document });
		expect(injectedLinks()).toHaveLength(0);
		expect(cleanup).toBeTypeOf('function');
	});

	it('does nothing for an empty locale', () => {
		loadLocaleFont({ locale: '', fonts, document });
		expect(injectedLinks()).toHaveLength(0);
	});
});

describe('loadLocaleFont — idempotency', () => {
	it('does not create duplicate links across repeated calls', () => {
		loadLocaleFont({ locale: 'ja', fonts, document });
		loadLocaleFont({ locale: 'ja', fonts, document });
		loadLocaleFont({ locale: 'ja-JP', fonts, document });
		expect(injectedLinks()).toHaveLength(2);
	});

	it('reuses an existing link element identity on repeat', () => {
		loadLocaleFont({ locale: 'ja', fonts, document });
		const first = injectedLinks().find((l) => l.rel === 'preload');
		loadLocaleFont({ locale: 'ja', fonts, document });
		const second = injectedLinks().find((l) => l.rel === 'preload');
		expect(first).toBe(second);
	});
});

describe('loadLocaleFont — cleanup', () => {
	it('removes the links it injected', () => {
		const cleanup = loadLocaleFont({ locale: 'ja', fonts, document });
		expect(injectedLinks()).toHaveLength(2);
		cleanup();
		expect(injectedLinks()).toHaveLength(0);
	});

	it('cleanup of a reused link removes the shared element once', () => {
		loadLocaleFont({ locale: 'ja', fonts, document });
		const cleanup = loadLocaleFont({ locale: 'ja', fonts, document });
		cleanup();
		expect(injectedLinks()).toHaveLength(0);
	});

	it('honours a custom marker attribute', () => {
		const cleanup = loadLocaleFont({
			locale: 'ja',
			fonts,
			document,
			marker: 'data-x-font',
		});
		expect(
			document.head.querySelectorAll('link[data-x-font]'),
		).toHaveLength(2);
		expect(injectedLinks()).toHaveLength(0);
		cleanup();
		expect(document.head.querySelectorAll('link[data-x-font]')).toHaveLength(0);
	});
});

describe('loadLocaleFont — SSR safety', () => {
	it('returns a no-op cleanup when no document is available', () => {
		const fakeNoHead = { head: null } as unknown as Document;
		const cleanup = loadLocaleFont({ locale: 'ja', fonts, document: fakeNoHead });
		expect(cleanup).toBeTypeOf('function');
		expect(() => cleanup()).not.toThrow();
	});
});
