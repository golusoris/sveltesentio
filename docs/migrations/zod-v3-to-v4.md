# Migrating Zod v3 → v4

> Required to adopt `@sveltesentio/core`, `@sveltesentio/forms`, `@sveltesentio/auth`,
> and any other schema-shipping package. Per [ADR-0001](../adr/0001-zod-v4-floor.md)
> the framework floor is `zod@^4`; **v3 is unsupported**. A v3 schema passed to the
> `zod4` Superforms adapter that `@sveltesentio/forms` wires will not validate or
> type-check correctly. This is the mechanical path from a v3 codebase (e.g.
> `zod@^3.25`) to v4.

## Why v4 is required

- **ADR-0001** sets a single Zod floor across the framework so schemas can be shared
  without version drift. `core` and `forms` use v4-only features (top-level string
  formats, `z.treeifyError`, smaller bundle).
- `@sveltesentio/core` `./env` surfaces `z.treeifyError(...)` in `EnvValidationError`.
- `@sveltesentio/forms` re-exports `superValidate` pre-wired to the **`zod4`** adapter
  (`sveltekit-superforms/adapters`), not the legacy v3 `zod` adapter.

## TL;DR checklist

1. `pnpm add zod@^4` (bump from `^3`).
2. Move string formats to the new top-level helpers (`z.string().email()` → `z.email()`).
3. Replace error customization (`message` / `invalid_type_error` / `required_error` /
   `errorMap`) with the unified `error` parameter.
4. Replace `.format()` / `.flatten()` with `z.treeifyError()` / `z.flattenError()`;
   read raw issues from `error.issues`.
5. Add an explicit key schema to every `z.record(value)` → `z.record(z.string(), value)`.
6. Prefer `z.strictObject()` / `z.looseObject()` over `.strict()` / `.passthrough()`.
7. Replace `z.nativeEnum(E)` with `z.enum(E)`.
8. **Forms:** pass v4 schemas to the re-exported `superValidate`; re-check inferred
   HTML constraints and refinement messages.
9. `tsc` + run tests; migrate one schema module at a time.

## API changes (v3 → v4)

### String formats are top-level

| v3 | v4 |
|---|---|
| `z.string().email()` | `z.email()` |
| `z.string().url()` | `z.url()` |
| `z.string().uuid()` | `z.uuid()` / `z.uuidv4()` |
| `z.string().datetime()` | `z.iso.datetime()` |
| `z.string().date()` | `z.iso.date()` |
| `z.string().ip()` | `z.ipv4()` / `z.ipv6()` |

The chained method forms are deprecated and emit warnings.

### Unified error customization

v3's `message`, `invalid_type_error`, `required_error`, and `errorMap` collapse into a
single `error` parameter:

```ts
// v3
z.string({ required_error: 'Required', invalid_type_error: 'Must be a string' })
  .min(1, { message: 'Too short' });

// v4
z.string({ error: (iss) => (iss.input === undefined ? 'Required' : 'Must be a string') })
  .min(1, { error: 'Too short' });
```

A literal string still works: `.min(1, { error: 'Too short' })`. The `{ message }` form
is a deprecated alias.

### Reading errors

```ts
import { z } from 'zod';

// v3
err.format();
err.flatten();

// v4
z.treeifyError(err); // nested tree — what core's createEnv reports
z.flattenError(err); // { formErrors, fieldErrors }
z.prettifyError(err); // human-readable string
err.issues; // raw issue array
```

### Records need an explicit key schema

```ts
// v3
z.record(z.number());
// v4
z.record(z.string(), z.number());
```

### Object strictness

```ts
// v3
z.object({ ... }).strict();
z.object({ ... }).passthrough();
// v4 (preferred)
z.strictObject({ ... });
z.looseObject({ ... });
```

The `.strict()` / `.passthrough()` / `.strip()` methods still exist but are deprecated.

### Enums

`z.nativeEnum(MyEnum)` → `z.enum(MyEnum)` — v4's `z.enum` accepts TS native enums.

### Defaults

v4 changed `.default()`: the default is applied when the input is `undefined` and is
treated as already-valid **output** (it is not re-parsed). If you relied on the v3
behavior of parsing the default value, use `.prefault(value)` instead.

### Unchanged

`z.coerce.*`, `.transform()`, `.pipe()`, `.refine()` keep their shape. `z.function()`
now takes `{ input, output }`.

## Forms-specific (`@sveltesentio/forms` + Superforms)

`@sveltesentio/forms` already imports the **`zod4`** adapter, so you pass your v4 schema
straight to the re-exported `superValidate` — no adapter call at the call site.

- **Adapter boundary**: drop any `zod(schema)` (v3 adapter) wrapping. Where you wrote
  `superValidate(form, zod(schema))`, use `@sveltesentio/forms`' `superValidate(form, schema)`.
- **Constraints**: Superforms infers HTML constraints (`required`, `min`, `max`,
  `minlength`, `pattern`) from the schema. v4's introspection differs slightly —
  re-verify generated constraints after migrating, especially `.min()/.max()` and
  `z.email()` (which still yields `type=email`).
- **Refinements**: `.refine()/.superRefine()` messages move to `{ error }`. Server-side
  field errors still flow through `@sveltesentio/forms`' `problemToFieldErrors`
  (RFC 9457 `invalid-params`) and Superforms' `setError` unchanged.

Example (auth login form):

```ts
// v3
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, { message: 'Min 8 chars' }),
});

// v4
const schema = z.object({
  email: z.email(),
  password: z.string().min(8, { error: 'Min 8 chars' }),
});
```

## Codemod

For most schemas a search-replace of the table above plus `tsc` is sufficient. Zod
publishes an upgrade guide and there is a community `zod-v3-to-v4` codemod. Migrate one
schema module at a time and run `tsc` after each so type errors stay localized.

## See also

- [ADR-0001](../adr/0001-zod-v4-floor.md) — the v4 floor decision and rationale.
- `@sveltesentio/core` `./env` (`createEnv` → `z.treeifyError`) and `./problem`.
- `@sveltesentio/forms` `superValidate` (zod4 adapter) and `problemToFieldErrors`.
