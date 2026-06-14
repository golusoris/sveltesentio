import { describe, expect, it } from 'vitest';
import { createPermissions } from '../src/permissions.js';

describe('createPermissions', () => {
	it('exposes an immutable snapshot of the input', () => {
		const perms = createPermissions(['billing.read', 'billing.write']);
		expect([...perms.permissions]).toEqual(['billing.read', 'billing.write']);
		expect(() => {
			(perms.permissions as unknown as string[]).push('x');
		}).toThrow();
	});

	it('has() does exact-key lookup', () => {
		const perms = createPermissions(['billing.read']);
		expect(perms.has('billing.read')).toBe(true);
		expect(perms.has('billing.write')).toBe(false);
	});

	it('can() matches wildcards up the dot-path', () => {
		const perms = createPermissions(['billing.*']);
		expect(perms.can('billing.read')).toBe(true);
		expect(perms.can('billing.write')).toBe(true);
		expect(perms.can('billing.invoice.delete')).toBe(true);
		expect(perms.can('reports.read')).toBe(false);
	});

	it('can() honours a root wildcard', () => {
		const perms = createPermissions(['*']);
		expect(perms.can('anything.here')).toBe(true);
	});

	it('anyOf / allOf compose can()', () => {
		const perms = createPermissions(['billing.read', 'reports.*']);
		expect(perms.anyOf('billing.read', 'reports.create')).toBe(true);
		expect(perms.anyOf('billing.write', 'users.read')).toBe(false);
		expect(perms.allOf('billing.read', 'reports.create')).toBe(true);
		expect(perms.allOf('billing.read', 'users.read')).toBe(false);
	});

	it('deduplicates input and tolerates null / undefined', () => {
		const perms = createPermissions(['billing.read', 'billing.read']);
		expect(perms.permissions.length).toBe(1);
		const empty = createPermissions(null);
		expect(empty.permissions.length).toBe(0);
		expect(empty.can('anything')).toBe(false);
	});

	it('can() returns false for empty pattern', () => {
		expect(createPermissions(['*']).can('')).toBe(false);
	});
});
