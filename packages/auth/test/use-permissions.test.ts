import { describe, expect, it } from 'vitest';
import { effect_root, flush } from 'svelte/internal/client';
import { usePermissions, type UsePermissions } from '../src/use-permissions.svelte.js';

/**
 * `usePermissions` is a runes module: `$derived(createPermissions(keys))` over a
 * `$state` array, with `set()` reassigning the backing state. Reading a `$derived`
 * and observing it recompute after a state write only works inside a reactive
 * scope, so every assertion runs through `withRoot`, which opens an
 * `$effect.root`, runs the body, flushes pending reactions, then tears the root
 * down (mirroring component unmount). This exercises the genuine Svelte runtime —
 * compiled from `use-permissions.svelte.ts` by the vitest config's runes plugin —
 * rather than a non-reactive shim, so `set()`-driven recomputation is real.
 */
function withRoot(
	body: (perms: UsePermissions) => void,
	initial?: Parameters<typeof usePermissions>[0],
): void {
	const cleanup = effect_root(() => {
		const perms = usePermissions(initial);
		body(perms);
	});
	flush();
	cleanup();
}

describe('usePermissions — initial state', () => {
	it('starts empty when constructed with no argument', () => {
		withRoot((perms) => {
			expect([...perms.permissions]).toEqual([]);
			expect(perms.has('anything')).toBe(false);
			expect(perms.can('anything')).toBe(false);
		});
	});

	it('starts empty for null / undefined initial keys', () => {
		withRoot((perms) => {
			expect([...perms.permissions]).toEqual([]);
		}, null);
		withRoot((perms) => {
			expect([...perms.permissions]).toEqual([]);
		}, undefined);
	});

	it('seeds the granted keys from an array', () => {
		withRoot(
			(perms) => {
				expect([...perms.permissions]).toEqual(['billing.read', 'billing.write']);
			},
			['billing.read', 'billing.write'],
		);
	});

	it('accepts any Iterable<string> (Set) as initial input', () => {
		withRoot(
			(perms) => {
				expect([...perms.permissions].sort()).toEqual(['reports.read', 'users.read']);
			},
			new Set(['users.read', 'reports.read']),
		);
	});

	it('copies the initial input — later mutation of the source does not leak in', () => {
		const source = ['billing.read'];
		withRoot((perms) => {
			source.push('billing.write');
			expect([...perms.permissions]).toEqual(['billing.read']);
			expect(perms.has('billing.write')).toBe(false);
		}, source);
	});

	it('exposes a frozen snapshot that rejects direct mutation', () => {
		withRoot(
			(perms) => {
				expect(() => {
					(perms.permissions as unknown as string[]).push('x');
				}).toThrow();
			},
			['billing.read'],
		);
	});
});

describe('usePermissions — has() exact-key lookup', () => {
	it('matches only the exact granted key, never a wildcard', () => {
		withRoot(
			(perms) => {
				expect(perms.has('billing.read')).toBe(true);
				expect(perms.has('billing.write')).toBe(false);
				// has() is exact: a granted wildcard does not satisfy has() of a leaf.
				expect(perms.has('reports.read')).toBe(false);
				expect(perms.has('reports.*')).toBe(true);
			},
			['billing.read', 'reports.*'],
		);
	});

	it('returns false for the empty string key', () => {
		withRoot(
			(perms) => {
				expect(perms.has('')).toBe(false);
			},
			['billing.read'],
		);
	});
});

describe('usePermissions — can() wildcard truth table', () => {
	it('matches an exact granted key', () => {
		withRoot(
			(perms) => {
				expect(perms.can('billing.read')).toBe(true);
			},
			['billing.read'],
		);
	});

	it('matches descendants of a dot-path wildcard at every depth', () => {
		withRoot(
			(perms) => {
				expect(perms.can('billing.read')).toBe(true);
				expect(perms.can('billing.write')).toBe(true);
				expect(perms.can('billing.invoice.delete')).toBe(true);
				expect(perms.can('reports.read')).toBe(false);
			},
			['billing.*'],
		);
	});

	it('a leaf wildcard does not grant the bare prefix itself', () => {
		withRoot(
			(perms) => {
				// 'billing.*' grants children, not the segment 'billing' on its own.
				expect(perms.can('billing')).toBe(false);
				expect(perms.can('billing.anything')).toBe(true);
			},
			['billing.*'],
		);
	});

	it('honours a root wildcard for any pattern', () => {
		withRoot(
			(perms) => {
				expect(perms.can('anything.here')).toBe(true);
				expect(perms.can('a.b.c.d')).toBe(true);
				expect(perms.can('top')).toBe(true);
			},
			['*'],
		);
	});

	it('returns false for an empty pattern even with a root wildcard', () => {
		withRoot(
			(perms) => {
				expect(perms.can('')).toBe(false);
			},
			['*'],
		);
	});

	it('returns false when no grant matches', () => {
		withRoot(
			(perms) => {
				expect(perms.can('users.delete')).toBe(false);
			},
			['billing.read', 'reports.*'],
		);
	});
});

describe('usePermissions — anyOf() / allOf() composition', () => {
	it('anyOf is true when at least one pattern is granted', () => {
		withRoot(
			(perms) => {
				expect(perms.anyOf('billing.read', 'reports.create')).toBe(true);
				expect(perms.anyOf('billing.write', 'users.read')).toBe(false);
			},
			['billing.read', 'reports.*'],
		);
	});

	it('allOf is true only when every pattern is granted', () => {
		withRoot(
			(perms) => {
				expect(perms.allOf('billing.read', 'reports.create')).toBe(true);
				expect(perms.allOf('billing.read', 'users.read')).toBe(false);
			},
			['billing.read', 'reports.*'],
		);
	});

	it('anyOf with no arguments is false (vacuous some)', () => {
		withRoot(
			(perms) => {
				expect(perms.anyOf()).toBe(false);
			},
			['*'],
		);
	});

	it('allOf with no arguments is true (vacuous every)', () => {
		withRoot((perms) => {
			expect(perms.allOf()).toBe(true);
		}, []);
	});
});

describe('usePermissions — empty and duplicate permission sets', () => {
	it('deduplicates the initial keys in the snapshot', () => {
		withRoot(
			(perms) => {
				expect([...perms.permissions]).toEqual(['billing.read']);
			},
			['billing.read', 'billing.read'],
		);
	});

	it('an empty set grants nothing', () => {
		withRoot((perms) => {
			expect([...perms.permissions]).toEqual([]);
			expect(perms.can('billing.read')).toBe(false);
			expect(perms.anyOf('a', 'b')).toBe(false);
			expect(perms.allOf('a')).toBe(false);
		}, []);
	});
});

describe('usePermissions — set() reactivity', () => {
	it('set() swaps the granted keys and the derived snapshot reflects it', () => {
		withRoot(
			(perms) => {
				expect([...perms.permissions]).toEqual(['billing.read']);
				perms.set(['reports.write']);
				expect([...perms.permissions]).toEqual(['reports.write']);
				expect(perms.has('billing.read')).toBe(false);
				expect(perms.has('reports.write')).toBe(true);
			},
			['billing.read'],
		);
	});

	it('can() recomputes through the derived after set()', () => {
		withRoot(
			(perms) => {
				expect(perms.can('billing.invoice.delete')).toBe(false);
				perms.set(['billing.*']);
				expect(perms.can('billing.invoice.delete')).toBe(true);
				expect(perms.can('reports.read')).toBe(false);
			},
			['users.read'],
		);
	});

	it('anyOf() / allOf() recompute through the derived after set()', () => {
		withRoot((perms) => {
			expect(perms.anyOf('billing.read', 'reports.read')).toBe(false);
			expect(perms.allOf('billing.read', 'reports.read')).toBe(false);
			perms.set(['billing.read', 'reports.read']);
			expect(perms.anyOf('billing.read', 'nope')).toBe(true);
			expect(perms.allOf('billing.read', 'reports.read')).toBe(true);
		}, []);
	});

	it('set(null) / set(undefined) clears all grants', () => {
		withRoot(
			(perms) => {
				expect(perms.can('billing.read')).toBe(true);
				perms.set(null);
				expect([...perms.permissions]).toEqual([]);
				expect(perms.can('billing.read')).toBe(false);
				perms.set(['*']);
				expect(perms.can('billing.read')).toBe(true);
				perms.set(undefined);
				expect([...perms.permissions]).toEqual([]);
			},
			['billing.read'],
		);
	});

	it('set() accepts an Iterable (Set) and deduplicates', () => {
		withRoot((perms) => {
			perms.set(new Set(['a.read', 'a.read', 'b.write']));
			expect([...perms.permissions].sort()).toEqual(['a.read', 'b.write']);
		});
	});

	it('set() copies its input — later source mutation does not leak in', () => {
		const next = ['billing.read'];
		withRoot((perms) => {
			perms.set(next);
			next.push('billing.write');
			expect([...perms.permissions]).toEqual(['billing.read']);
			expect(perms.has('billing.write')).toBe(false);
		});
	});

	it('repeated set() calls each fully replace the prior grants', () => {
		withRoot(
			(perms) => {
				perms.set(['a']);
				expect(perms.has('a')).toBe(true);
				perms.set(['b']);
				expect(perms.has('a')).toBe(false);
				expect(perms.has('b')).toBe(true);
				perms.set([]);
				expect([...perms.permissions]).toEqual([]);
			},
			['seed'],
		);
	});

	it('the snapshot stays frozen after set()', () => {
		withRoot(
			(perms) => {
				perms.set(['reports.read']);
				expect(() => {
					(perms.permissions as unknown as string[]).push('x');
				}).toThrow();
			},
			['billing.read'],
		);
	});
});
