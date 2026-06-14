export { paraglideVitePlugin } from '@inlang/paraglide-js';

export { getTextDirection } from './direction.js';
export type { TextDirection } from './direction.js';

export {
	formatCurrency,
	formatDate,
	formatList,
	formatNumber,
	formatRelativeTime,
} from './intl.js';

export {
	announceNavigation,
	ensureAnnouncerRegion,
	restoreFocus,
} from './announcer.js';
export type { AnnouncerOptions, AnnouncerPoliteness } from './announcer.js';

// Component layer (v0.2.0). The `.svelte` components — <LangSync>,
// <LocaleSwitcher> — ship from their own subpaths (`@sveltesentio/i18n/lang-sync`,
// `/locale-switcher`) because plain `tsc` does not resolve `.svelte` modules.
// The type-checked, unit-tested pure core (per-locale font loader) is re-exported
// here.
export { loadLocaleFont } from './load-locale-font.js';
export type {
	LoadLocaleFontOptions,
	LocaleFontAsset,
	LocaleFontMap,
} from './load-locale-font.js';
