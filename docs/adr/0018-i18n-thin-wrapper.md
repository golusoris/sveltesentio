# ADR-0018: Keep thin `@sveltesentio/i18n` wrapper (Paraglide v2 re-export + a11y action items)

- **Status**: Accepted
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D172 in `.workingdir/research/decisions-needed.md`

## Context

With ADR-0017 locking Paraglide v2 (`@inlang/paraglide-js@^2.16.0`) as the framework i18n default, the follow-on question is whether sveltesentio ships a wrapper or documents direct consumption. A thin re-export + a11y-hardening surface pins the matrix once and gives every downstream app one adoption surface. A `docs/compose/` downgrade would force each app to re-wire middleware + typed keys + switcher a11y per consumer.

The D50 re-audit (`reaudit-d50-paraglide.md`) confirmed the `@inlang/paraglide-sveltekit` adapter is deprecated — the wrapper surface now wraps a **single dep** (`@inlang/paraglide-js@^2`). The audit also surfaced 6 a11y action items Paraglide does not ship (lang/dir auto-sync, switcher variants, live announcer, focus restoration, typed keys, per-locale font loading) — these belong in the wrapper, not duplicated across every consumer app.

## Decision

Keep thin `@sveltesentio/i18n` wrapper around `@inlang/paraglide-js@^2` only (no separate adapter dep). Wrapper ships 6 a11y action items:

1. Auto-sync `<html lang>` + `<html dir>` via `getTextDirection()` utility (Paraglide v2.13.0+) — consumer cannot forget.
2. `<Switcher>` component with 3 variants tied to `ui/preset-*`:
   - `variant="select"` — desktop/mobile native (shadcn Select wrapped).
   - `variant="dialog"` — 10-foot (large remote-navigable list).
   - `variant="sheet"` — handheld (bottom-sheet overlay).
3. `aria-live="polite"` locale-change announcer region (1 line per change).
4. Focus-restoration util (sessionStorage-based `preserveFocus()` → re-apply on `onMount` after locale reload).
5. Typed message-keys passthrough from paraglide-generated `.d.ts` (direct re-export, no re-implementation).
6. Per-locale font-loading hook (`loadLocaleFonts(locale)` for CJK/Arabic/Hebrew; returns a promise consumer wires in layout `load()`).

The wrapper hides nothing from Paraglide's API — it locks the version, the hooks wiring, and ships the a11y surface Paraglide itself does not cover. Currency / number formatting helpers (D53) are deferred to a future sub-export if distinct ownership emerges.

## Alternatives considered

- **Downgrade to `docs/compose/i18n.md` only** — forces every app to rewire middleware + switcher a11y + typed keys; loses version-pin benefit and duplicates a11y implementation cost across 4 consumer apps.
- **Fuller wrapper that hides Paraglide entirely** — premature abstraction; no downstream app has asked to swap the i18n backend.
- **Bundle currency/number formatting into the i18n module now** — defer until distinct ownership emerges (D53 open).
- **Direct inlang SDK re-export** — Paraglide is the recommended output; lower-level re-export adds no value.
- **Ship only the typed-keys helper, no switcher / lang auto-sync** — leaves WCAG 2.2 AA gaps (missing `dir`, switcher a11y, focus loss) for every consumer to re-solve.

## Consequences

**Positive**:

- One pinned `@inlang/paraglide-js@^2` dep; consumers update via `@sveltesentio/i18n` bump.
- 6 a11y action items implemented once, not per-app — WCAG 2.2 AA (lang, dir, focus, live-region, touch targets) guaranteed at wrapper boundary.
- Switcher variants tied to `ui/preset-*` satisfy D170 preset-aware invariant (10-foot / handheld / desktop form-factors).
- Typed-keys helper removes a common boilerplate / string-typo class.
- arca's existing integration migrates to the wrapper by removing `@inlang/paraglide-sveltekit` + switching to `paraglideVitePlugin()` — one-shot cleanup.

**Negative / trade-offs**:

- Thin wrapper is still an owned surface (version matrix + a11y action items + export map).
- Switcher variants drag a dep on `@sveltesentio/ui` preset primitives — ordering: `ui` ships before `i18n` switcher component lands.
- Per-locale font-loading hook has no Paraglide counterpart → wrapper owns a non-trivial util.

**Documentation obligations**:

- `@sveltesentio/i18n/AGENTS.md` — pinned version, 6 a11y action items contract, export map, switcher variants ↔ preset mapping.
- `docs/compose/i18n.md` — adapter-static requires `paths: { relative: false }`; strategy must include `cookie` for SSR; `data-sveltekit-reload` required on switcher links.
- `docs/compose/i18n-fonts.md` — `@font-face` `unicode-range` + `font-display: swap` pattern for CJK/Arabic/Hebrew; wired via `loadLocaleFonts()` hook in layout `load()`.
- Cross-link to ADR-0017 (default lock) and `reaudit-d50-paraglide.md` (audit source).

## Evidence

- `.workingdir/research/reaudit-d50-paraglide.md` §"A11y action items" — the 6-item contract above is a direct lift.
- `.workingdir/research/reaudit-d50-paraglide.md` §4 "Best-fit layout per device" — drives 3 switcher variants (`select` / `dialog` / `sheet`).
- `.workingdir/research/deepread-arca.md:18,34,87` — arca's Paraglide integration is the reference.
- `.workingdir/research/decisions-needed.md:252` — streamlining verdict: "D172 (`i18n`) Blocked on D50. Single adopter (arca); not enough evidence for either direction".
- `.workingdir/research/decisions-needed.md:318` — user closure: "Unblocked by D50 → keep thin wrapper".
- Cross-reference ADR-0017 (`docs/adr/0017-paraglide-v2-i18n-default.md`) for the upstream lock.
