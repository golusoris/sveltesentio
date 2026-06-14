/**
 * `@sveltesentio/ui/cmd` — command-registry + keybinding model (ADR-0025). The
 * pure registry / search / rank store and the `tinykeys`-style keymap parser
 * are exported here and unit-tested. The `bits-ui` Command palette
 * (`CommandPalette.svelte`) and `tinykeys` are OPTIONAL peers wired by the
 * thin `.svelte` consumer.
 */

export {
	type Command,
	type RankedCommand,
	CommandRegistry,
	scoreCommand,
	searchCommands,
} from './registry.js';

export {
	type KeyEventLike,
	type KeyBinding,
	type KeyMap,
	parseBinding,
	matchesBinding,
	matchesShortcut,
	resolveKeymap,
	isApplePlatform,
} from './keybinding.js';
