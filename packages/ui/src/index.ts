// @sveltesentio/ui — Tailwind 4 preset + oklch tokens + shadcn-svelte delivery.
// Component wrappers (button/input/dialog/…), ui/data, ui/cmd, ui/toast are
// follow-through (see AGENTS.md). Tokens + presets land here so the export map
// resolves and downstream apps can apply the theme + interface presets today.
export * from './tokens/index.js';
export * from './presets/index.js';
