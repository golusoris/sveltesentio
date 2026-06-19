// Stand-ins for SvelteKit's `$app/*` virtual modules so the upstream
// `superForm` client (imported as the default seam by `useForm`) resolves under
// the plain Node test runner. `useForm`'s tests always inject a fake `superForm`,
// so these are never actually exercised — they only need to be importable to
// satisfy the static `$app/*` imports in `sveltekit-superforms/client`. The
// vitest config aliases every `$app/*` specifier to this module.
import { readable } from 'svelte/store';

// $app/environment
export const browser = false;
export const dev = false;
export const building = false;
export const version = 'test';

// $app/stores
export const page = readable({ url: new URL('http://localhost/'), form: undefined });
export const navigating = readable(null);
export const updated = readable(false);
export function getStores(): {
	page: typeof page;
	navigating: typeof navigating;
	updated: typeof updated;
} {
	return { page, navigating, updated };
}

// $app/navigation
export function goto(): Promise<void> {
	return Promise.resolve();
}
export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}
export function beforeNavigate(): void {}
export function afterNavigate(): void {}

// $app/forms
export function enhance(): { destroy(): void } {
	return { destroy() {} };
}
export function applyAction(): Promise<void> {
	return Promise.resolve();
}
export function deserialize<T>(result: string): T {
	return JSON.parse(result) as T;
}
