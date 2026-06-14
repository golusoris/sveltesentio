import { createPermissions, type PermissionsApi } from './permissions.js';

export type PermissionKeys = readonly string[] | Iterable<string> | null | undefined;

export interface UsePermissions extends PermissionsApi {
	/** Replace the granted keys; `permissions`/`has`/`can`/`anyOf`/`allOf` recompute reactively. */
	set(next: PermissionKeys): void;
}

/**
 * Runes wrapper over {@link createPermissions} for `.svelte` consumers. Holds the
 * granted keys in `$state` and derives a wildcard-aware {@link PermissionsApi};
 * `set()` swaps the keys and every `can()` in the template re-evaluates. Use it
 * once per component (e.g. seeded from `+layout.server.ts` session permissions).
 *
 * ```svelte
 * <script>
 *   const perms = usePermissions(data.permissions);
 * </script>
 * {#if perms.can('billing.read')}<BillingPanel />{/if}
 * ```
 */
export function usePermissions(initial?: PermissionKeys): UsePermissions {
	let keys = $state<string[]>(initial ? [...initial] : []);
	const api = $derived(createPermissions(keys));

	return {
		get permissions() {
			return api.permissions;
		},
		has: (key) => api.has(key),
		can: (pattern) => api.can(pattern),
		anyOf: (...patterns) => api.anyOf(...patterns),
		allOf: (...patterns) => api.allOf(...patterns),
		set: (next) => {
			keys = next ? [...next] : [];
		},
	};
}
