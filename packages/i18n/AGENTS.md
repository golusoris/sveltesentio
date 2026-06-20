# @sveltesentio/i18n — AGENTS.md

> Paraglide v2 wrapper with a11y + RTL + direction-sync baked in. Phase 6 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

Thin wrapper over `@inlang/paraglide-js@^2.16.0` (ADR-0017). **The deprecated `@inlang/paraglide-sveltekit` adapter is not used** — Paraglide v2 integrates via the framework-agnostic `paraglideVitePlugin()` exported from `@inlang/paraglide-js` directly.

### Landed (v0.0.1)

| Export                                                                                 | Purpose                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `paraglideVitePlugin`                                                                  | Passthrough from `@inlang/paraglide-js` — callers pass their own `project` / `outdir` / `strategy`                                    |
| `getTextDirection(locale)`                                                             | BCP-47 script-subtag + language lookup → `'ltr' \| 'rtl'`                                                                             |
| `announceNavigation(msg)`                                                              | `aria-live="polite"` announcer for SPA nav — writes into a singleton region, cleared-then-set via `queueMicrotask` so SR re-announces |
| `ensureAnnouncerRegion(opts?)`                                                         | Idempotent creation of the visually-hidden live region; configurable politeness + region id + `document` for SSR testing              |
| `restoreFocus(selector)`                                                               | Returns `true` on successful `.focus()`, `false` when selector misses                                                                 |
| `formatCurrency` / `formatNumber` / `formatDate` / `formatRelativeTime` / `formatList` | Intl passthroughs — no separate currency module ([D53 locked](../../.workingdir/research/decisions-needed.md))                        |

### Landed (later)

| Export             | Purpose                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `<LangSync>`       | Auto-sets `<html lang>` + `<html dir>` via `getTextDirection(locale)` on route change (`./lang-sync`) |
| `<LocaleSwitcher>` | Three preset variants tied to `ui/preset-{desktop,10foot,handheld}` (`./locale-switcher`)             |
| `loadLocaleFont`   | Per-locale variable-font loader hook, pairs with `ui/font-preset-*` (`./load-locale-font`)            |

### Follow-through (not in v0.0.1)

| Export      | Purpose                                              |
| ----------- | ---------------------------------------------------- |
| `typedKeys` | Passthrough of Paraglide's typed message-keys export |

## Strategy

Per [ADR-0040](../../docs/adr/0040-paraglide-strategy-logical-properties.md):

```ts
paraglideVitePlugin({
  project: './project.inlang',
  outdir: './src/lib/paraglide',
  strategy: ['url', 'cookie', 'baseLocale'],
});
```

- `url` — SEO-friendly locale prefix (`/de/…`).
- `cookie` — SSR fallback when URL is root.
- `baseLocale` — last resort.

## RTL invariant

- **Tailwind 4 logical properties only** (`ms-*` / `me-*` / `ps-*` / `pe-*`). ESLint warns on physical `ml-*` / `mr-*` in new code.
- `<html dir>` auto-set via `getTextDirection(locale)` based on BCP-47 tag script subtag. Arabic, Hebrew, Persian, Urdu, Yiddish → `rtl`.

## Six a11y action items (per ADR-0018)

1. **lang/dir auto-sync** — `<LangSync>` hook in root layout.
2. **Three Switcher variants** — desktop dropdown, 10-foot spatial grid, handheld bottom-sheet, all tied to `ui/preset-*`.
3. **`aria-live` announcer** — `announceNavigation` for SPA route + locale transitions.
4. **Focus restoration** — after locale-switch reload.
5. **Typed-keys passthrough** — prevents string-typo class of bugs.
6. **Per-locale font-loading hook** — `loadLocaleFont` prevents FOUT / wrong-script CJK fallback.

## Invariants

- **Paraglide v2 only** — v1 integration patterns (adapter, context.json) are obsolete.
- **Never re-implement Intl.** Currency / number / date go through `Intl.*` passthroughs.
- **Messages are compiled, not loaded.** No runtime JSON fetches; tree-shaken per-locale bundles.

## Sub-exports

| Path                                  | Purpose                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `@sveltesentio/i18n`                  | Full surface                                                                   |
| `@sveltesentio/i18n/direction`        | `getTextDirection` + `TextDirection` (zero-dep pull — no Paraglide / DOM deps) |
| `@sveltesentio/i18n/intl`             | Intl formatter passthroughs alone                                              |
| `@sveltesentio/i18n/announcer`        | Announcer + focus utilities (DOM-only)                                         |
| `@sveltesentio/i18n/load-locale-font` | `loadLocaleFont` per-locale variable-font loader                               |
| `@sveltesentio/i18n/lang-sync`        | `<LangSync>` lang/dir auto-sync component                                      |
| `@sveltesentio/i18n/locale-switcher`  | `<LocaleSwitcher>` preset-aware locale switcher                                |

## Test policy

- Unit tests cover `getTextDirection` over the BCP-47 script-subtag table (landed: 4 cases × multiple locales).
- DOM-level tests for `ensureAnnouncerRegion` / `announceNavigation` / `restoreFocus` under jsdom (landed).
- Intl formatters covered for locale-sensitive output (landed).
- Integration tests verifying `<html lang>` + `<html dir>` update on route change land with `<LangSync>` (follow-through).
- a11y lane verifies `aria-live` announcements fire on navigation (follow-through).

## Common tasks

| Task              | Command                                              |
| ----------------- | ---------------------------------------------------- |
| Typecheck         | `pnpm --filter @sveltesentio/i18n typecheck`         |
| Unit tests        | `pnpm --filter @sveltesentio/i18n test`              |
| Paraglide codegen | `pnpm --filter @sveltesentio/i18n paraglide:compile` |

## Related ADRs

- [ADR-0017](../../docs/adr/0017-paraglide-v2-i18n-default.md) — Paraglide v2 as default.
- [ADR-0018](../../docs/adr/0018-i18n-thin-wrapper.md) — keep thin wrapper + 6 a11y action items.
- [ADR-0040](../../docs/adr/0040-paraglide-strategy-logical-properties.md) — strategy + RTL + logical properties.
