// SPDX-FileCopyrightText: 2026 lusoris <lusoris@pm.me>
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, it } from 'vitest';
import {
	assertLocaleParity,
	compareLocales,
	findEmptyValues,
	getValue,
	keySet,
	MAX_NODES,
	missing,
	placeholders,
	type AssertLocaleParityOptions,
	type ParityResult,
	type PlaceholderMismatch,
} from '../src/locale-parity.js';

describe('pure in-memory parity checks', () => {
	describe('positive cases', () => {
		it('accepts identical maps with matching placeholders and formatters', () => {
			const base = {
				app_name: 'SnatchArr',
				greeting: 'Hello {name}!',
				metrics: '{count: number} items processed',
			};
			const target = {
				app_name: 'SnatchArr',
				greeting: 'Hallo {name}!',
				metrics: '{count: number} Einträge verarbeitet',
			};

			const result: ParityResult = compareLocales(base, target);
			expect(result.missingKeys).toEqual([]);
			expect(result.extraKeys).toEqual([]);
			expect(result.emptyValues).toEqual([]);
			expect(result.placeholderMismatches).toEqual([]);
		});

		it('assertLocaleParity passes on identical and compatible multi-locale maps', () => {
			const catalogs = {
				en: {
					title: 'Title',
					greeting: 'Hello {name}',
				},
				de: {
					title: 'Titel',
					greeting: 'Hallo {name}',
				},
			};
			const options: AssertLocaleParityOptions = { base: 'en' };
			expect(() => assertLocaleParity(catalogs, options)).not.toThrow();
		});

		it('assertLocaleParity passes for a single base catalog without other locales', () => {
			expect(() => assertLocaleParity({ en: { app: 'App' } }, { base: 'en' })).not.toThrow();
		});
	});

	describe('negative cases', () => {
		it('detects missing keys with planted negative case', () => {
			const base = { first: 'First', second: 'Second' };
			const target = { first: 'Erste' };

			const baseKeys = keySet(base);
			const targetKeys = keySet(target);
			expect(missing(baseKeys, targetKeys)).toEqual(['second']);

			const result = compareLocales(base, target);
			expect(result.missingKeys).toEqual(['second']);
		});

		it('detects extra keys', () => {
			const base = { first: 'First' };
			const target = { first: 'Erste', unexpected: 'Unerwartet' };

			const baseKeys = keySet(base);
			const targetKeys = keySet(target);
			expect(missing(targetKeys, baseKeys)).toEqual(['unexpected']);

			const result = compareLocales(base, target);
			expect(result.extraKeys).toEqual(['unexpected']);
		});

		it('detects empty and whitespace-only string values', () => {
			const target = {
				valid: 'Valid',
				empty: '',
				whitespace: '   ',
				num: 42,
			};

			expect(findEmptyValues(target)).toEqual(['empty', 'whitespace']);

			const base = { valid: 'Valid', empty: 'Empty', whitespace: 'Space', num: 42 };
			const result = compareLocales(base, target);
			expect(result.emptyValues).toEqual(['empty', 'whitespace']);
		});

		it('detects renamed and mismatched placeholders with planted mismatch', () => {
			const base = {
				user_msg: 'Hello {name}',
				stat_msg: '{used} of {cap}',
				extra_ph: 'Welcome {user}',
				count_msg: 'Total: {count}',
			};
			const target = {
				user_msg: 'Hallo {username}',
				stat_msg: '{used} von {total}',
				extra_ph: 'Willkommen {user} ({role})',
				count_msg: 'Gesamt: {cnt}',
			};

			const result = compareLocales(base, target);
			const expectedMismatches: PlaceholderMismatch[] = [
				{
					key: 'count_msg',
					expected: ['count'],
					actual: ['cnt'],
				},
				{
					key: 'extra_ph',
					expected: ['user'],
					actual: ['role', 'user'],
				},
				{
					key: 'stat_msg',
					expected: ['cap', 'used'],
					actual: ['total', 'used'],
				},
				{
					key: 'user_msg',
					expected: ['name'],
					actual: ['username'],
				},
			];
			expect(result.placeholderMismatches).toEqual(expectedMismatches);
		});

		it('assertLocaleParity throws listing all findings for failed catalogs', () => {
			const catalogs = {
				en: {
					greeting: 'Hello {name}',
					count: '{count: number}',
					only_in_base: 'Base',
					empty: 'NotEmpty',
				},
				de: {
					greeting: 'Hallo {username}',
					count: '{cnt: number}',
					extra: 'Extra',
					empty: '   ',
				},
			};

			expect(() => assertLocaleParity(catalogs, { base: 'en' })).toThrowError(
				/Locale parity check failed:\n\[de\] missing keys: only_in_base\n\[de\] extra keys: extra\n\[de\] empty values: empty\n\[de\] placeholder mismatches: count \(expected \[count\], got \[cnt\]\); greeting \(expected \[name\], got \[username\]\)/,
			);
		});

		it('assertLocaleParity throws when base locale contains empty string values', () => {
			const catalogs = {
				en: {
					valid: 'Valid',
					blank: '  ',
				},
			};
			expect(() => assertLocaleParity(catalogs, { base: 'en' })).toThrow(
				/\[en\] empty values: blank/,
			);
		});

		it('assertLocaleParity throws when base locale is missing from catalogs', () => {
			const catalogs = {
				en: { title: 'Title' },
			};
			expect(() => assertLocaleParity(catalogs, { base: 'de' })).toThrow(
				'assertLocaleParity: base locale "de" not found in catalogs',
			);
		});

		it('assertLocaleParity reports non-plain-object catalogs', () => {
			const catalogs = {
				en: { title: 'Title' },
				de: null as unknown as Record<string, unknown>,
			};
			expect(() => assertLocaleParity(catalogs, { base: 'en' })).toThrow(
				/\[de\] catalog is not a plain object/,
			);
		});
	});

	describe('boundary cases', () => {
		it('handles empty maps gracefully', () => {
			const base = {};
			const target = {};

			expect(Array.from(keySet(base))).toEqual([]);
			expect(missing(keySet(base), keySet(target))).toEqual([]);

			const result = compareLocales(base, target);
			expect(result.missingKeys).toEqual([]);
			expect(result.extraKeys).toEqual([]);
			expect(result.emptyValues).toEqual([]);
			expect(result.placeholderMismatches).toEqual([]);

			expect(() => assertLocaleParity({ en: {}, de: {} }, { base: 'en' })).not.toThrow();
		});

		it('handles single key maps', () => {
			const base = { solo: 'Only one' };
			const target = { solo: 'Nur eins' };

			expect(Array.from(keySet(base))).toEqual(['solo']);
			const result = compareLocales(base, target);
			expect(result.missingKeys).toEqual([]);
			expect(result.extraKeys).toEqual([]);
		});

		it('retains empty nested object keys as leaf nodes', () => {
			const base = { group: {} };
			expect(Array.from(keySet(base))).toEqual(['group']);
		});

		it('flattens and validates nested objects per format specifications', () => {
			const base = {
				nav: {
					dashboard: 'Dashboard',
					settings: {
						title: 'Settings',
						save: 'Save {target}',
					},
				},
			};
			const target = {
				nav: {
					dashboard: 'Übersicht',
					settings: {
						title: 'Einstellungen',
						save: 'Speichere {target}',
					},
				},
			};

			expect(Array.from(keySet(base)).sort()).toEqual([
				'nav.dashboard',
				'nav.settings.save',
				'nav.settings.title',
			]);

			const result = compareLocales(base, target);
			expect(result.missingKeys).toEqual([]);
			expect(result.extraKeys).toEqual([]);
			expect(result.emptyValues).toEqual([]);
			expect(result.placeholderMismatches).toEqual([]);
		});

		it('detects nested missing keys and empty values', () => {
			const base = {
				group: {
					a: 'Alpha',
					b: 'Beta',
				},
			};
			const target = {
				group: {
					a: '   ',
				},
			};

			const result = compareLocales(base, target);
			expect(result.missingKeys).toEqual(['group.b']);
			expect(result.emptyValues).toEqual(['group.a']);
		});

		it('ignores $schema key at root', () => {
			const catalog = {
				$schema: 'https://inlang.com/schema/inlang-message-format',
				greeting: 'Hello',
			};

			expect(Array.from(keySet(catalog))).toEqual(['greeting']);
			expect(findEmptyValues(catalog)).toEqual([]);
		});

		it('extracts placeholders from array of message variants and nested structures', () => {
			const variants = [
				{ match: { count: '1' }, value: 'One item for {user}' },
				{ match: { count: '*' }, value: '{count: number} items for {user}' },
			];

			expect(Array.from(placeholders(variants)).sort()).toEqual(['count', 'user']);
			expect(Array.from(placeholders({ sub: 'nested {name}' }))).toEqual(['name']);
			expect(Array.from(placeholders(123))).toEqual([]);
			expect(Array.from(placeholders('no placeholders'))).toEqual([]);
			expect(Array.from(placeholders(null))).toEqual([]);
		});

		it('matches placeholders in linear time on an unterminated run of whitespace', () => {
			const unterminated = `{0:${' '.repeat(100_000)}`;
			const started = performance.now();
			expect(Array.from(placeholders(unterminated))).toEqual([]);
			expect(performance.now() - started).toBeLessThan(1_000);
			expect(Array.from(placeholders('{ name }{n:fmt }{x'))).toEqual(['name', 'n']);
		});

		it('refuses a catalog or value past the node cap MAX_NODES', () => {
			expect(MAX_NODES).toBe(100_000);
			const huge = Object.fromEntries(
				Array.from({ length: MAX_NODES + 1 }, (_, i) => [`k${i}`, 'v']),
			);
			expect(() => keySet(huge)).toThrow(/exceeds 100000 nodes/);
			expect(() => placeholders(Array.from({ length: MAX_NODES }, () => 'v'))).toThrow(
				/exceeds 100000 nodes/,
			);
			expect(keySet(Object.fromEntries([['only', 'v']])).size).toBe(1);
		});

		it('evaluates getValue across flat and nested paths', () => {
			const record = {
				flat: 'value',
				nested: { child: 'deep' },
			};

			expect(getValue(record, 'flat')).toBe('value');
			expect(getValue(record, 'nested.child')).toBe('deep');
			expect(getValue(record, 'nested.missing')).toBeUndefined();
			expect(getValue(record, 'nonexistent.child')).toBeUndefined();
			expect(getValue(record, 'flat.child')).toBeUndefined();
			expect(getValue({}, 'empty')).toBeUndefined();
		});
	});
});
