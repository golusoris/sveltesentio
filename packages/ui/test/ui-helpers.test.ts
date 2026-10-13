// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApplePlatform } from '../src/cmd/index.js';
import { FOCUSABLE_SELECTOR } from '../src/dialog/index.js';
import { lucideDynamicLoader } from '../src/icons/index.js';

const MockArrowLeft = { name: 'ArrowLeft' };

vi.mock('@lucide/svelte/icons/arrow-left', () => ({
	default: MockArrowLeft,
}));

describe('isApplePlatform', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('detects Apple platforms via navigator.platform (MacIntel, iPhone, iPad)', () => {
		vi.stubGlobal('navigator', { platform: 'MacIntel' });
		expect(isApplePlatform()).toBe(true);

		vi.stubGlobal('navigator', { platform: 'iPhone' });
		expect(isApplePlatform()).toBe(true);

		vi.stubGlobal('navigator', { platform: 'iPad' });
		expect(isApplePlatform()).toBe(true);

		vi.stubGlobal('navigator', { platform: 'iPod' });
		expect(isApplePlatform()).toBe(true);
	});

	it('detects Apple platforms via userAgentData.platform taking precedence', () => {
		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'macOS' },
			platform: 'Linux x86_64',
		});
		expect(isApplePlatform()).toBe(true);
	});

	it('returns false for non-Apple platforms (Linux, Windows, Android)', () => {
		vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
		expect(isApplePlatform()).toBe(false);

		vi.stubGlobal('navigator', { platform: 'Win32' });
		expect(isApplePlatform()).toBe(false);

		vi.stubGlobal('navigator', {
			userAgentData: { platform: 'Windows' },
			platform: 'MacIntel',
		});
		expect(isApplePlatform()).toBe(false);
	});

	it('returns false when navigator is undefined (SSR boundary)', () => {
		vi.stubGlobal('navigator', undefined);
		expect(isApplePlatform()).toBe(false);
	});

	it('returns false for empty platform strings', () => {
		vi.stubGlobal('navigator', { platform: '' });
		expect(isApplePlatform()).toBe(false);
	});
});

describe('FOCUSABLE_SELECTOR', () => {
	let container: HTMLElement | undefined;

	afterEach(() => {
		if (container && container.parentNode) {
			container.parentNode.removeChild(container);
			container = undefined;
		}
	});

	function createFixture(html: string): HTMLElement {
		container = document.createElement('div');
		container.innerHTML = html;
		document.body.appendChild(container);
		return container;
	}

	it('matches the exact compound selector string', () => {
		const expected = [
			'a[href]',
			'button:not([disabled])',
			'input:not([disabled])',
			'select:not([disabled])',
			'textarea:not([disabled])',
			'[tabindex]:not([tabindex="-1"])',
		].join(',');
		expect(FOCUSABLE_SELECTOR).toBe(expected);
	});

	it('queries and includes all standard enabled interactive elements', () => {
		const host = createFixture(`
			<a href="#test">Link</a>
			<button type="button">Btn</button>
			<input type="text" />
			<select><option>1</option></select>
			<textarea></textarea>
			<div tabindex="0">Custom</div>
		`);
		const matches = Array.from(host.querySelectorAll(FOCUSABLE_SELECTOR));
		expect(matches).toHaveLength(6);
	});

	it('excludes disabled controls, anchor without href, and negative tabindex', () => {
		const host = createFixture(`
			<button disabled>Disabled Btn</button>
			<input disabled />
			<select disabled><option>1</option></select>
			<textarea disabled></textarea>
			<a>Anchor without href</a>
			<div tabindex="-1">Skipped div</div>
			<p>Plain text</p>
			<span>Plain span</span>
		`);
		const matches = Array.from(host.querySelectorAll(FOCUSABLE_SELECTOR));
		expect(matches).toHaveLength(0);
	});

	it('returns zero matches on an empty container boundary', () => {
		const host = createFixture('');
		const matches = Array.from(host.querySelectorAll(FOCUSABLE_SELECTOR));
		expect(matches).toHaveLength(0);
	});
});

describe('lucideDynamicLoader', () => {
	it('dynamically imports and resolves a known icon in kebab-case', async () => {
		const icon = await lucideDynamicLoader('arrow-left');
		expect(icon).toBe(MockArrowLeft);
	});

	it('resolves PascalCase name to the same icon module', async () => {
		const iconPascal = await lucideDynamicLoader('ArrowLeft');
		expect(iconPascal).toBe(MockArrowLeft);
	});

	it('rejects with error when icon name does not exist', async () => {
		await expect(lucideDynamicLoader('definitely-not-an-existing-icon-xyz-123')).rejects.toThrow();
	});

	it('rejects when given an empty name boundary', async () => {
		await expect(lucideDynamicLoader('')).rejects.toThrow();
	});
});
