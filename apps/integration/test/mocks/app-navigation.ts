// Stub for SvelteKit's `$app/navigation` virtual module (see app-environment.ts).
// The `@sveltesentio/forms` barrel re-exports superforms' client `superForm`,
// which imports these at module load even when only the server `superValidate`
// is used. No-op implementations suffice for the server-side validation tests.
export const goto = async (): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const invalidate = async (): Promise<void> => {};
export const beforeNavigate = (): void => {};
export const afterNavigate = (): void => {};
export const onNavigate = (): void => {};
export const pushState = (): void => {};
export const replaceState = (): void => {};
