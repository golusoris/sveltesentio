import { describe, expect, it } from 'vitest';
import {
	formatCurrency,
	formatDate,
	formatList,
	formatNumber,
	formatRelativeTime,
} from '../src/intl.js';

describe('intl passthroughs', () => {
	it('formats numbers per locale', () => {
		expect(formatNumber(1234.5, 'en-US')).toBe('1,234.5');
		expect(formatNumber(1234.5, 'de-DE')).toBe('1.234,5');
	});

	it('formats currency with explicit code', () => {
		const eur = formatCurrency(19.99, 'de-DE', 'EUR', { minimumFractionDigits: 2 });
		expect(eur).toMatch(/19,99/);
		expect(eur).toMatch(/€/);
	});

	it('formats dates given Date/number/string', () => {
		const iso = '2026-04-18T00:00:00Z';
		const fromString = formatDate(iso, 'en-US', { year: 'numeric', month: 'short' });
		expect(fromString).toMatch(/2026/);
		const fromNumber = formatDate(new Date(iso).getTime(), 'en-US', { year: 'numeric' });
		expect(fromNumber).toBe('2026');
		const fromDate = formatDate(new Date(iso), 'en-US', { year: 'numeric' });
		expect(fromDate).toBe('2026');
	});

	it('formats relative time', () => {
		expect(formatRelativeTime(-1, 'day', 'en-US', { numeric: 'auto' })).toBe('yesterday');
	});

	it('formats lists', () => {
		expect(formatList(['apples', 'pears', 'oranges'], 'en-US')).toBe(
			'apples, pears, and oranges',
		);
	});
});
