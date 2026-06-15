/**
 * `@sveltesentio/ui/icons` — pluggable icon system (ADR-0002). `@lucide/svelte`
 * is the default set; apps `registerIconLoader` for other sets (e.g. Iconify)
 * with no framework patch. Use `<Icon name="arrow-left" />` for components, or
 * the pure registry API for resolution. The `Icon.svelte` component is exported
 * via the package's `svelte` export condition.
 */

export {
	type IconComponent,
	type IconLoader,
	type IconResolution,
	IconRegistry,
	registerIconLoader,
	setDefaultIconLoader,
	resolveIcon,
} from './registry.js';

export {
	type LucideIconModule,
	createLucideLoader,
	lucideDynamicLoader,
	toPascalCase,
	toKebabCase,
} from './lucide.js';
