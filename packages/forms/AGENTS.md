# @sveltesentio/forms — AGENTS.md

> Thin wrapper over `sveltekit-superforms@^2` + Zod v4 with RFC 9457 field-error mapping. Phase 5 per [.workingdir/PLAN.md](../../.workingdir/PLAN.md).

## Scope

This package **is** a thin wrapper — justified because:

1. **Pins the matrix.** Superforms v2 + Zod v4 adapter + optional Formsnap v2, so downstream apps don't have to reason about the three-way version dance.
2. **Pre-wires the Zod v4 adapter.** Callers pass the raw schema; the package picks the correct adapter (`zod4` upstream, not the legacy `zod` v3 one).
3. **Bridges RFC 9457 into Superforms.** `problemToFieldErrors()` turns a `ProblemError` from `@sveltesentio/core` into the `Record<string, string[]>` field-error shape Superforms expects — the framework value-add this package is built around (ADR-0019).
4. **Re-exports the runtime surface Superforms consumers actually use** (`superForm`, proxies, `message`, `setError`, `fail`) so apps import one package instead of two.

| Export | Purpose |
|---|---|
| `superValidate(schema, options?)` | Pre-wired Zod v4 adapter; returns defaults |
| `superValidate(data, schema, options?)` | Parses `Request` / `FormData` / `URL` through the v4 adapter |
| `superForm` | Upstream re-export (client-side store/rune contract) |
| `problemToFieldErrors(err)` | `ProblemError` → `Record<string, string[]>` Superforms shape |
| `fail`, `message`, `setError`, `setMessage` | Upstream re-exports |
| `*Proxy` helpers, `actionResult`, `defaults`, `schemaShape`, `mergeFormUnion`, `splitPath`, `withFiles`, `removeFiles`, `SuperFormError`, `SchemaError` | Upstream re-exports |

Plain-state pattern documented in [docs/compose/forms.md](../../docs/compose/forms.md) Path 1 for trivial forms that don't need Superforms machinery.

## Sub-exports

| Path | Purpose |
|---|---|
| `@sveltesentio/forms` | Everything above |
| `@sveltesentio/forms/problem` | Just `problemToFieldErrors` + `FieldErrors` type (zero-dependency pull) |

## Invariants

- **Zod v4 only.** v3 schemas fail at the adapter boundary (ADR-0001). The wrapper imports `zod4` from `sveltekit-superforms/adapters`, never the legacy `zod` adapter.
- **Server-side validation always runs.** Client-side validation is a UX guard; every form action re-validates on the server via `superValidate(request, schema)`.
- **Errors surface as RFC 9457 `ProblemError`** and are mapped to Superforms per-field errors via `problemToFieldErrors`. Never surface `{ code, message }` bags — the core's `ProblemError` is the only error contract.
- **Server import path.** `superValidate` pulls from `sveltekit-superforms/server`, not the root entry, so it works in Node test runners without a Svelte compiler (the root entry re-exports `SuperDebug.svelte`).

## Accessibility

Wired by consumer-side markup — this package does not ship components. Recipe in [docs/compose/forms.md](../../docs/compose/forms.md) covers `aria-invalid` + `aria-describedby` + `role="alert"` on the `<form>`. Optional Formsnap integration handles the wiring automatically via peer `formsnap@^2`.

## Test policy

- Unit tests cover `superValidate` defaults, `FormData` parsing (valid + invalid), and `problemToFieldErrors` aggregation.
- Integration tests in downstream apps (revenge, arca) hit real Superforms actions — do **not** mock `superValidate`. Mocking forms has a history of masking real bugs (prior incident).

## Follow-through

- Formsnap re-export barrel (`/formsnap` subpath) — add when first downstream adopts Formsnap.
- Runes-native `useForm()` rune over `superForm` (ADR-0003 calls this out; not urgent — `superForm` already returns a reactive surface).
- `formAction()` server helper wrapping the `fail({ form })` + `ProblemError` round-trip in one call.

## Common tasks

| Task | Command |
|---|---|
| Typecheck | `pnpm --filter @sveltesentio/forms typecheck` |
| Unit tests | `pnpm --filter @sveltesentio/forms test` |

## Related ADRs

- [ADR-0001](../../docs/adr/0001-zod-v4-floor.md) — Zod v4 floor.
- [ADR-0003](../../docs/adr/0003-forms-thin-superforms-wrapper.md) — thin Superforms wrapper with plain-state docs compose.
- [ADR-0019](../../docs/adr/0019-openapi-fetch-rfc9457.md) — RFC 9457 on the HTTP side; forms map it to field errors.
