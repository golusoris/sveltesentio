---
pinned-version: 4.x
canonical-url: https://zod.dev
last-verified: 2026-04-18
---

# Zod — v4.x snapshot

Pinned: **`zod ^4.0.0`** (peerDependency in `@sveltesentio/core`; consumed by `@sveltesentio/forms`)
Canonical: https://zod.dev

Zod v4 is a non-trivial bump from v3. Several v3 patterns are renamed or removed.

## Imports

```ts
import { z } from 'zod';                 // standard
import { z } from 'zod/v4';              // pin v4 import path during transition (if exposed by your install)
```

## Schemas

```ts
const User = z.object({
  id: z.uuid(),                          // top-level — was z.string().uuid() in v3
  email: z.email(),                      // top-level — was z.string().email()
  age: z.number().int().nonnegative(),
  role: z.enum(['admin', 'user']),
  createdAt: z.iso.datetime(),           // ISO 8601 — namespaced under z.iso in v4
  tags: z.array(z.string()).default([])
});

type User = z.infer<typeof User>;
```

Top-level format constructors in v4 (commonly hallucinated as v3 chained form):

| v4 | v3 equivalent |
|---|---|
| `z.uuid()` | `z.string().uuid()` |
| `z.email()` | `z.string().email()` |
| `z.url()` | `z.string().url()` |
| `z.iso.datetime()` | `z.string().datetime()` |
| `z.iso.date()` | `z.string().date()` |
| `z.cuid2()` | `z.string().cuid2()` |

## Parsing

```ts
const result = User.parse(input);                  // throws ZodError
const safe   = User.safeParse(input);              // { success, data | error }
const async  = await User.parseAsync(input);

if (!safe.success) {
  // v4: structured error tree
  const tree = z.treeifyError(safe.error);         // { errors, properties: { email: { errors: [...] } } }
  const flat = z.flattenError(safe.error);         // { formErrors, fieldErrors }
}
```

## Coercion

```ts
const Coerced = z.object({
  age: z.coerce.number().int(),
  active: z.coerce.boolean(),
  joined: z.coerce.date()
});
```

## Composition

```ts
const Base = z.object({ id: z.uuid() });
const WithName = Base.extend({ name: z.string().min(1) });
const Partial = WithName.partial();
const Picked = WithName.pick({ name: true });
const Omitted = WithName.omit({ id: true });

const Either = z.union([z.string(), z.number()]);
const Disc = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('a'), aOnly: z.string() }),
  z.object({ kind: z.literal('b'), bOnly: z.number() })
]);
```

## Refinements + transforms

```ts
const Strong = z.string().min(8).refine(
  (s) => /[A-Z]/.test(s) && /[0-9]/.test(s),
  { message: 'needs upper + digit' }
);

const Trimmed = z.string().transform((s) => s.trim());
const Pipe = z.string().pipe(z.coerce.number()); // pipe v4 syntax
```

## `sveltesentio` usage

- Every API boundary (`+server.ts`, `actions`, RPC) validates input with Zod. Enforced by [docs/principles.md](../../principles.md) §2.2.
- `@sveltesentio/forms` adapts `zod` schemas via `sveltekit-superforms`'s `zod4Adapter` (NOT `zodAdapter` — that's v3).
- Env validation in `@sveltesentio/core` uses Zod schemas.

## Gotchas

- `z.string().uuid()` still works (compat) but `z.uuid()` is the v4-canonical form.
- `z.string().datetime()` is a deprecated alias for `z.iso.datetime()`.
- `z.record(V)` now requires explicit key schema: `z.record(z.string(), V)`.
- Error format changed: prefer `z.treeifyError` / `z.flattenError` over walking `error.issues` manually.
- `z.preprocess` is still present but `z.string().pipe(z.coerce.number())` is preferred.
- `z.brand` for nominal types: `z.string().brand<'UserId'>()`.

## Links

- v3 → v4 changelog: https://zod.dev/v4/changelog
- API reference: https://zod.dev/api
