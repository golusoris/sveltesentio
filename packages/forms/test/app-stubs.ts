// Stand-ins for SvelteKit's `$app/*` virtual modules so the upstream
// `superForm` client (imported as the default seam by `useForm`) resolves under
// the plain Node test runner. `useForm`'s tests always inject a fake `superForm`,
// so these are never actually exercised — they only need to be importable to
// satisfy the static `$app/*` imports in `sveltekit-superforms/client` and the
// bare `import '$app/server';` guard in `sveltekit-superforms/server`. The vitest
// config aliases every `$app/*` specifier to this module.
// $app/state
export const page = { url: new URL('http://localhost/'), form: undefined };
export const navigating = { from: null, to: null, type: null };

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
