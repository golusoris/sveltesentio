// Stub for SvelteKit's `$app/forms` virtual module (see app-environment.ts).
// Pulled in by superforms' client `superForm` via the `@sveltesentio/forms` barrel.
import type { ActionResult } from '@sveltejs/kit';

export const applyAction = async (): Promise<void> => {};
export const deserialize = <T>(result: string): ActionResult<Record<string, T>> =>
	JSON.parse(result) as ActionResult<Record<string, T>>;
export const enhance = (): { destroy: () => void } => ({ destroy: () => {} });
