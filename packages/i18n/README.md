# @sveltesentio/i18n

> Paraglide JS v2 integration — locale routing, RTL support, message utilities

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Status

v0.3.0 — shipped: `paraglideVitePlugin` passthrough, `getTextDirection`/RTL, Intl formatters, the a11y announcer, `loadLocaleFont`, and the `<LangSync>` / `<LocaleSwitcher>` components.

## Sub-exports

| Import                                | What                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltesentio/i18n`                  | `paraglideVitePlugin` plus the re-export surface for everything below                                                                        |
| `@sveltesentio/i18n/direction`        | `getTextDirection`, `TextDirection` — resolves a locale to `ltr` / `rtl`                                                                     |
| `@sveltesentio/i18n/intl`             | `formatNumber`, `formatCurrency`, `formatDate`, `formatRelativeTime`, `formatList` — `Intl.*` wrappers                                       |
| `@sveltesentio/i18n/load-locale-font` | `loadLocaleFont`, `LocaleFontMap` — loads the font a locale needs instead of shipping every script up front                                  |
| `@sveltesentio/i18n/announcer`        | `announceNavigation`, `ensureAnnouncerRegion`, `restoreFocus` — the live region that tells a screen reader a client-side navigation happened |
| `@sveltesentio/i18n/lang-sync`        | `<LangSync>` — keeps `<html lang>` and `dir` in step with the active locale                                                                  |
| `@sveltesentio/i18n/locale-switcher`  | `<LocaleSwitcher>` — the locale-selection control                                                                                            |

## Installation

```bash
pnpm add @sveltesentio/i18n
```

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
