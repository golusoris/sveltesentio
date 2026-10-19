// SPDX-FileCopyrightText: 2026 lusoris <lusoris@pm.me>
// SPDX-License-Identifier: EUPL-1.2
//
// Ported from lusoris/SnatchArr web/src/lib/i18n-parity.ts

/** Matches {name} placeholders, including formatters like {count: number}. */
// The colon and whitespace branches are disjoint, so a failed match never
// backtracks over the same characters twice (no polynomial ReDoS).
const PLACEHOLDER_PATTERN = /\{\s*([a-zA-Z0-9_]+)(?::[^}]*|\s*)\}/g;

/** Upper bound on the nodes one catalog walk visits (HISS-02). */
export const MAX_NODES = 100_000;

export interface PlaceholderMismatch {
	key: string;
	expected: string[];
	actual: string[];
}

export interface ParityResult {
	missingKeys: string[];
	extraKeys: string[];
	emptyValues: string[];
	placeholderMismatches: PlaceholderMismatch[];
}

export interface AssertLocaleParityOptions {
	base: string;
}

interface Entry {
	path: string;
	value: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childEntries(record: Record<string, unknown>, prefix: string): Entry[] {
	return Object.entries(record)
		.filter(([key]) => prefix !== '' || key !== '$schema')
		.map(([key, value]) => ({ path: prefix ? `${prefix}.${key}` : key, value }));
}

/** Lists every leaf and every empty object of a catalog with its dotted path, without recursion. */
function leaves(record: Record<string, unknown>): Entry[] {
	const found: Entry[] = [];
	const stack = childEntries(record, '');
	for (let visited = 0; stack.length > 0; visited++) {
		if (visited >= MAX_NODES) {
			throw new Error(`message catalog exceeds ${MAX_NODES} nodes`);
		}
		const entry = stack.pop();
		if (!entry) {
			break;
		}
		if (isPlainObject(entry.value) && Object.keys(entry.value).length > 0) {
			stack.push(...childEntries(entry.value, entry.path));
		} else {
			found.push(entry);
		}
	}
	return found;
}

/** Extracts all keys from a message catalog, flattening nested objects. */
export function keySet(record: Record<string, unknown>): Set<string> {
	return new Set(leaves(record).map((entry) => entry.path));
}

/** Returns sorted list of keys present in expected but missing from actual. */
export function missing(expected: Set<string>, actual: Set<string>): string[] {
	const result: string[] = [];
	for (const key of expected) {
		if (!actual.has(key)) {
			result.push(key);
		}
	}
	return result.sort();
}

function extractPlaceholdersFromString(text: string, result: Set<string>): void {
	for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
		const name = match[1];
		if (name !== undefined) {
			result.add(name);
		}
	}
}

function pushChildren(item: unknown, stack: unknown[]): void {
	if (Array.isArray(item)) {
		for (const elem of item as unknown[]) {
			stack.push(elem);
		}
	} else if (isPlainObject(item)) {
		for (const val of Object.values(item)) {
			stack.push(val);
		}
	}
}

/** Extracts placeholder variable names from a string, variant array, or object. */
export function placeholders(value: unknown): Set<string> {
	const result = new Set<string>();
	const stack: unknown[] = [value];
	for (let visited = 0; stack.length > 0; visited++) {
		if (visited >= MAX_NODES) {
			throw new Error(`message value exceeds ${MAX_NODES} nodes`);
		}
		const item = stack.pop();
		if (typeof item === 'string') {
			extractPlaceholdersFromString(item, result);
		} else {
			pushChildren(item, stack);
		}
	}
	return result;
}

/** Finds all keys with empty or whitespace-only string values. */
export function findEmptyValues(record: Record<string, unknown>): string[] {
	return leaves(record)
		.filter((entry) => typeof entry.value === 'string' && entry.value.trim() === '')
		.map((entry) => entry.path)
		.sort();
}

/** Resolves a key or dot-separated path in a record. */
export function getValue(record: Record<string, unknown>, keyPath: string): unknown {
	if (Object.hasOwn(record, keyPath)) {
		return record[keyPath];
	}
	const parts = keyPath.split('.');
	let current: unknown = record;
	for (const part of parts) {
		if (!isPlainObject(current)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return a.every((val, index) => val === b[index]);
}

function findPlaceholderMismatches(
	base: Record<string, unknown>,
	target: Record<string, unknown>,
	baseKeys: Set<string>,
	targetKeys: Set<string>,
): PlaceholderMismatch[] {
	const mismatches: PlaceholderMismatch[] = [];
	for (const key of baseKeys) {
		if (!targetKeys.has(key)) {
			continue;
		}
		const basePh = Array.from(placeholders(getValue(base, key))).sort();
		const targetPh = Array.from(placeholders(getValue(target, key))).sort();
		if (!arraysEqual(basePh, targetPh)) {
			mismatches.push({
				key,
				expected: basePh,
				actual: targetPh,
			});
		}
	}
	mismatches.sort((a, b) => a.key.localeCompare(b.key));
	return mismatches;
}

/** Compares target locale catalog against base locale catalog. */
export function compareLocales(
	base: Record<string, unknown>,
	target: Record<string, unknown>,
): ParityResult {
	const baseKeys = keySet(base);
	const targetKeys = keySet(target);

	return {
		missingKeys: missing(baseKeys, targetKeys),
		extraKeys: missing(targetKeys, baseKeys),
		emptyValues: findEmptyValues(target),
		placeholderMismatches: findPlaceholderMismatches(base, target, baseKeys, targetKeys),
	};
}

function formatMismatch(m: PlaceholderMismatch): string {
	return `${m.key} (expected [${m.expected.join(', ')}], got [${m.actual.join(', ')}])`;
}

function collectLocaleIssues(locale: string, result: ParityResult): string[] {
	const issues: string[] = [];
	if (result.missingKeys.length > 0) {
		issues.push(`missing keys: ${result.missingKeys.join(', ')}`);
	}
	if (result.extraKeys.length > 0) {
		issues.push(`extra keys: ${result.extraKeys.join(', ')}`);
	}
	if (result.emptyValues.length > 0) {
		issues.push(`empty values: ${result.emptyValues.join(', ')}`);
	}
	if (result.placeholderMismatches.length > 0) {
		const m = result.placeholderMismatches.map(formatMismatch).join('; ');
		issues.push(`placeholder mismatches: ${m}`);
	}
	return issues.map((issue) => `[${locale}] ${issue}`);
}

/**
 * Asserts that all target locale catalogs match the base catalog in keys and placeholders.
 * Throws an Error with all findings if parity checks fail.
 */
export function assertLocaleParity(
	catalogs: Record<string, Record<string, unknown>>,
	{ base }: AssertLocaleParityOptions,
): void {
	const baseCatalog = catalogs[base];
	if (!baseCatalog || !isPlainObject(baseCatalog)) {
		throw new Error(`assertLocaleParity: base locale "${base}" not found in catalogs`);
	}

	const issues: string[] = [];
	const baseEmpty = findEmptyValues(baseCatalog);
	if (baseEmpty.length > 0) {
		issues.push(`[${base}] empty values: ${baseEmpty.join(', ')}`);
	}

	const otherLocales = Object.keys(catalogs)
		.filter((loc) => loc !== base)
		.sort();

	for (const locale of otherLocales) {
		const targetCatalog = catalogs[locale];
		if (!targetCatalog || !isPlainObject(targetCatalog)) {
			issues.push(`[${locale}] catalog is not a plain object`);
			continue;
		}
		const result = compareLocales(baseCatalog, targetCatalog);
		issues.push(...collectLocaleIssues(locale, result));
	}

	if (issues.length > 0) {
		throw new Error(`Locale parity check failed:\n${issues.join('\n')}`);
	}
}
