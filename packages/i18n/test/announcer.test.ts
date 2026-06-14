import { afterEach, describe, expect, it } from 'vitest';
import {
	announceNavigation,
	ensureAnnouncerRegion,
	restoreFocus,
} from '../src/announcer.js';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ensureAnnouncerRegion', () => {
	it('creates a polite live region on first call', () => {
		const region = ensureAnnouncerRegion();
		expect(region).toBeDefined();
		expect(region?.getAttribute('aria-live')).toBe('polite');
		expect(region?.getAttribute('role')).toBe('status');
	});

	it('reuses an existing region with the same id', () => {
		const first = ensureAnnouncerRegion();
		const second = ensureAnnouncerRegion();
		expect(first).toBe(second);
		expect(document.querySelectorAll('#sentio-a11y-announcer').length).toBe(1);
	});

	it('honours custom politeness + region id', () => {
		const region = ensureAnnouncerRegion({
			politeness: 'assertive',
			regionId: 'custom-region',
		});
		expect(region?.getAttribute('aria-live')).toBe('assertive');
		expect(region?.id).toBe('custom-region');
	});
});

describe('announceNavigation', () => {
	it('writes the message into the live region after a microtask', async () => {
		announceNavigation('Navigated to dashboard');
		await Promise.resolve();
		const region = document.getElementById('sentio-a11y-announcer');
		expect(region?.textContent).toBe('Navigated to dashboard');
	});

	it('resets the region before writing so SR re-announces', async () => {
		announceNavigation('first');
		await Promise.resolve();
		announceNavigation('second');
		const region = document.getElementById('sentio-a11y-announcer');
		expect(region?.textContent).toBe('');
		await Promise.resolve();
		expect(region?.textContent).toBe('second');
	});
});

describe('restoreFocus', () => {
	it('focuses a matching element and reports success', () => {
		const input = document.createElement('input');
		input.id = 'focus-me';
		document.body.appendChild(input);
		expect(restoreFocus('#focus-me')).toBe(true);
		expect(document.activeElement).toBe(input);
	});

	it('returns false when no element matches', () => {
		expect(restoreFocus('#missing')).toBe(false);
	});
});
