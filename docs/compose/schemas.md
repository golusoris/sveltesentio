# Zod v4 schemas — idioms for sveltesentio

Schemas are the single validation surface for every API boundary:
`+server.ts`, `+page.server.ts`, form actions, ConnectRPC handlers, CLI
argument parsers. This recipe documents the patterns sveltesentio
consumers should reach for first.

See [ADR-0001](../adr/0001-zod-v4-floor.md) for the version-floor decision.
Authoritative API docs: <https://zod.dev>.

## Install

```bash
pnpm add zod
```

Peer range is `^4.0.0`. v3 schemas are **not** supported — ADR-0001 forbids
them in new code, and `@sveltesentio/forms` + `@sveltesentio/core` assume v4
shapes (discriminated-union narrowing, first-class error issues with `code`
+ `path`, top-level `z.email()` / `z.uuid()` / `z.url()`).

## The five patterns you actually need

### 1. Strict parsing at the boundary

Reject unknown fields. Framework default.

```ts
// schema.ts
import { z } from 'zod';

export const createUser = z
  .object({
    email: z.email(),
    name: z.string().min(1).max(120),
    preferredLang: z.enum(['en', 'de']).default('en'),
  })
  .strict();
```

```ts
// +server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from './schema';

export const POST: RequestHandler = async ({ request }) => {
  const parsed = createUser.safeParse(await request.json());
  if (!parsed.success) {
    // Flatten into an RFC 9457 `application/problem+json` envelope —
    // `@sveltesentio/core/errors` exports a helper for this.
    throw error(422, { zodIssues: parsed.error.issues });
  }
  // ... use parsed.data
};
```

**Why `.strict()`**: Zod's default in v4 is still `.passthrough({}) === never`
(drop unknown but don't fail). For API surfaces we want the *fail* behaviour
so a typo like `emaail:` becomes a 422 instead of silent data loss.

### 2. Discriminated unions for variant payloads

Narrow with `z.discriminatedUnion(key, […])` — faster + better error messages
than a bare `z.union`.

```ts
export const appEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user.created'),
    userId: z.uuid(),
    at: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal('upload.completed'),
    uploadId: z.uuid(),
    bytes: z.number().int().nonnegative(),
    at: z.iso.datetime(),
  }),
]);

export type AppEvent = z.infer<typeof appEvent>;
```

Downstream switch exhausts automatically:

```ts
function handle(event: AppEvent) {
  switch (event.kind) {
    case 'user.created':
      return greet(event.userId);
    case 'upload.completed':
      return index(event.uploadId, event.bytes);
  }
  event satisfies never;
}
```

### 3. Cross-field refinements

Use `.refine()` / `.check()` for invariants spanning multiple fields. Keep
the rule near the schema — the error message is the UI's error message.

```ts
export const dateRange = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((v) => v.from <= v.to, {
    message: '`from` must be on or before `to`',
    path: ['to'],
  });
```

`path` is mandatory when the rule spans fields — it tells Superforms which
input to mark invalid.

### 4. Brand types for IDs

Prevent accidental ID mixups at the type level.

```ts
export const userId = z.uuid().brand<'UserId'>();
export type UserId = z.infer<typeof userId>;

export const tenantId = z.uuid().brand<'TenantId'>();
export type TenantId = z.infer<typeof tenantId>;

// These are *structurally* both `string`, but TypeScript refuses:
declare function loadUser(id: UserId): Promise<User>;
declare const someTenant: TenantId;
// loadUser(someTenant); // Error — TenantId is not UserId
```

Pair with [ADR-0023](../adr/0023-uuid-v7-default.md): use `uuidv7()` from
`@sveltesentio/core/id` when generating.

### 5. Environment schema

Runtime config is parsed once at startup. Fail loud, fail early.

```ts
// src/env.ts
import { z } from 'zod';
import { env } from '$env/dynamic/private';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
});

export const appEnv = envSchema.parse(env);
```

`@sveltesentio/core/env` will ship a helper wrapping this pattern so that
every consumer starts from a known-shape. For now, repeat this recipe.

## What *not* to reach for

- **`z.any()` / `z.unknown()` at the boundary.** Use a concrete schema; if
  truly arbitrary, validate downstream before use. Hard rule 9 (no `any`).
- **`.passthrough()` on untrusted inputs.** Strips invariants.
- **Async `.transform()` on hot paths.** Zod runs transforms sequentially;
  batch async work outside the parser.
- **`z.object({ … }).partial()` as a PATCH schema.** Use `.partial()` only
  for intermediate types; API-surface PATCH schemas usually require *at
  least one* field — use `.refine((v) => Object.keys(v).length > 0)`.
- **`z.record(z.string(), z.any())` for JSON payloads.** Write the shape.

## Integration points

| Module | Pattern |
|---|---|
| `@sveltesentio/forms` | Superforms adapter takes a Zod schema directly; `superValidate(event, zod(schema))`. See [compose/forms.md](forms.md) (pending). |
| `@sveltesentio/core/errors` | `zodIssuesToProblem(issues, { type, title })` produces RFC 9457 `application/problem+json` with `invalid-params` (RFC 7807 extension). |
| `@sveltesentio/query` | Server-returned Zod-parsed types flow into `QueryFn<Data>` automatically via `z.infer`. |
| `openapi-fetch` middleware | Validate response `data` with a Zod schema before returning — rejects server drift. |

## References

- ADR-0001 — v4 floor.
- ADR-0019 — `openapi-fetch` + RFC 9457.
- ADR-0023 — UUIDv7 default.
- Zod docs: <https://zod.dev>.
- RFC 9457: <https://www.rfc-editor.org/rfc/rfc9457>.
