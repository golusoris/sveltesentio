# ADR-0026: `marked` + `DOMPurify` for runtime markdown; `mdsvex` for authored markdown

- **Status**: Proposed
- **Date**: 2026-04-17
- **Deciders**: @lusoris (user), research agent
- **D-row**: D28 + D168 in `.workingdir/research/decisions-needed.md`

## Context

Markdown has two distinct use cases that collapse into a bad choice if mixed:

1. **Runtime user-input markdown** (chat, comments, notes) — must sanitise every `innerHTML` boundary. arca's `NotesEditor.svelte:62-63` ships literal TODO "should add DOMPurify in prod" with zero DOMPurify imports. Dispositive XSS risk.
2. **Build-time authored markdown** (`.md` pages, docs) — compiled to Svelte components; no runtime HTML injection.

A single library for both optimises the wrong axis.

## Decision

Split by lane, both delivered inside `@sveltesentio/ui/markdown`:

- **Runtime**: `marked@^18` + `DOMPurify@^3` pipeline. The wrapper's `<Markdown source={...}>` component **always** runs output through `DOMPurify.sanitize()` with a hardened allowlist; opt-out is a loud API (`unsafe={true}` + ESLint rule discouraging).
- **Build-time**: `mdsvex@^0.12` preprocessor wired into `svelte.config.js`. Authored `.md`/`.svx` files compile to Svelte components at build; no runtime sink.

Fold D168 (keep wrapper) into this ADR — the DOMPurify sink is exactly the cross-cutting invariant that justifies the wrapper over raw compose.

## Alternatives considered

- **`marked` only, DOMPurify optional** — perpetuates arca's TODO pattern; at least one real XSS waiting.
- **`svelte-markdown`** — smaller but bundles a sanitiser with a weaker default allowlist; worse than DOMPurify's maintained rules.
- **`mdsvex` for runtime too** — mdsvex is a compile-time preprocessor; wrong tool for user input.

## Consequences

**Positive**:
- XSS sink closed by construction; every `innerHTML` path in `ui/markdown` is DOMPurified.
- Authored docs stay ergonomic via mdsvex.
- arca's TODO pattern replaced with a single import.

**Negative / trade-offs**:
- Two deps where one might feel simpler; split reflects genuinely distinct concerns.
- DOMPurify allowlist maintenance is now a framework responsibility — changes go via ADR amendment.

**Documentation obligations**:
- `docs/compose/markdown.md` — runtime vs build-time guidance, allowlist rationale, unsafe escape hatch.
- `docs/compliance/xss-sinks.md` (new) — lists every `innerHTML` boundary and how `@sveltesentio/*` closes it.
- Downstream migration: arca + revenge replace direct `marked.parse` calls with `<Markdown>`.

## Evidence

- `.workingdir/research/ecosystem-pass-1-summary.md:63,69` — D28 + D168 picks.
- `.workingdir/research/ecosystem-batch-b.md` — arca XSS TODO (dispositive).
- `.workingdir/research/deepread-arca.md` — `NotesEditor.svelte:62-63` literal TODO.
