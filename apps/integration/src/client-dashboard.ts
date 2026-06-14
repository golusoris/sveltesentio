/**
 * Client composition: `@sveltesentio/query` (`createSentioQuery` + `useOptimistic`)
 * for server state, plus `@sveltesentio/ui` design tokens, interface presets, and
 * the command registry for the chrome. The query factories call `useQueryClient()`
 * and so must run inside a `QueryClientProvider` (component context); they are kept
 * as exported factories here to prove the typed surface composes. The pure UI bits
 * (registry/tokens/presets) are exercised directly by the unit tests.
 */
import { createSentioQuery, useOptimistic } from '@sveltesentio/query';
import { themeCss, lightTokens, darkTokens } from '@sveltesentio/ui/tokens';
import type { SemanticTokens } from '@sveltesentio/ui/tokens';
import { presetCss, presets } from '@sveltesentio/ui/presets';
import type { InterfaceType, InterfacePreset } from '@sveltesentio/ui/presets';
import { CommandRegistry, searchCommands } from '@sveltesentio/ui/cmd';
import type { Command, RankedCommand } from '@sveltesentio/ui/cmd';
import type { Item } from './server-prefetch.js';

/** A query for the item list, typed with the sveltesentio `ProblemError` channel. */
export function itemsQuery(fetchItems: () => Promise<readonly Item[]>) {
	return createSentioQuery({
		queryKey: ['items'],
		queryFn: () => fetchItems().then((items) => [...items]),
	});
}

/** Optimistic rename mutation against the cached `['items', id]` entry. */
export function renameItem(id: string, rename: (title: string) => Promise<Item>) {
	return useOptimistic<Item, string, Item>({
		queryKey: ['items', id],
		mutationFn: (title) => rename(title),
		optimisticUpdate: (previous, title) =>
			previous ? { ...previous, title } : { id, title },
	});
}

/** Theme + interface CSS the dashboard injects, proving the ui token/preset surface. */
export function dashboardCss(
	interfaceType: InterfaceType,
	overrides?: { light?: SemanticTokens; dark?: SemanticTokens },
): string {
	const light = overrides?.light ?? lightTokens;
	const dark = overrides?.dark ?? darkTokens;
	const preset: InterfacePreset = presets[interfaceType];
	return [themeCss({ light, dark }), presetCss(preset, ':root')].join('\n\n');
}

/** Build the command palette registry from the dashboard's actions. */
export function buildCommandRegistry(commands: readonly Command[]): CommandRegistry {
	return new CommandRegistry().register(...commands);
}

/** Search the registry, returning ranked commands (re-exported pure helper). */
export function searchPalette(registry: CommandRegistry, query: string): RankedCommand[] {
	return searchCommands(registry.commands, query);
}
