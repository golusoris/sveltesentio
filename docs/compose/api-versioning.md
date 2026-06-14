# API versioning — URL-segment default with deprecation flow

Public APIs that outlive a single client need a versioning strategy,
or every schema change becomes a breaking change that can't ship.
There are three mainstream shapes — URL-segment (`/api/v2/orders`),
media-type header (`Accept: application/vnd.acme.v2+json`), and
date-based (`Accept-Version: 2026-04-18`) — each with different ergonomics
for clients, proxies, caches, and observability. This recipe picks
**URL-segment as the default** and codifies when to reach for
header-based or date-based alternatives, the deprecation lifecycle
(announce → sunset-header → 410 Gone), and the SvelteKit route layout
that makes this cheap.

Per [ADR-0019](../adr/0019-structured-error-envelope.md) (RFC 9457
boundary contracts) and [principles.md §2.2](../principles.md)
(OWASP ASVS L2 — stable error envelopes), a deprecation is a contract:
announce it, header it via RFC 8594 `Sunset` + RFC 7234 `Deprecation`,
and enforce a removal date. No silent breaks, no indefinite
double-maintenance.

## Related

- [http-client.md](http-client.md) — client-side `openapi-fetch` with
  a pinned `baseUrl: '/api/v2'`; version bump is a codegen refresh,
  not a hand-edit.
- [schemas.md](schemas.md) — Zod schemas live alongside the route;
  major version = new schema file, minor version = additive change
  with `.optional()`.
- [observability.md](observability.md) — every request tagged with
  `api.version` + `api.deprecated` bounded labels for usage-by-version
  dashboards.
- [feature-flags.md](feature-flags.md) — gradual v2 rollout via
  flag; dark-launch the new route before announcing.
- [webhooks.md](webhooks.md) — webhook *payload* versioning is a
  different problem (provider-controlled); this recipe covers
  *receiver/sender* API versioning only.
- [monorepo-releases.md](monorepo-releases.md) — `BREAKING CHANGE:`
  commits that bump API major always carry a `Migration:` footer.
- [principles.md §2.7](../principles.md) — SemVer + release discipline.

## Default: URL-segment (`/api/v1`, `/api/v2`)

```text
GET /api/v1/orders/42
GET /api/v2/orders/42
```

**Why default:** visible in every log, every proxy path, every
browser URL bar. Cache keys split naturally. OpenAPI-doc URLs look
sensible (`/api/v2/openapi.json`). Clients pin by changing a single
string. The cost is URL-churn-on-breaking-change, which is exactly
what we want — a major bump is visible.

Reach for **header-based** (`Accept: application/vnd.acme.v2+json`)
when:
- You operate a true hypermedia API (HAL / JSON:API with navigation
  links), where clients follow `Link:` headers and the version
  decoration fits the content-negotiation model. This is rare — we
  don't build hypermedia APIs by default.

Reach for **date-based** (`Accept-Version: 2026-04-18`) when:
- You ship breaking changes often enough that integer majors become
  meaningless (Stripe/Shopify-scale). Not our scale; the surface
  cost of the date-matrix is real (Stripe's "version rollup"
  machinery is a team's work).

Everything else: **URL-segment**.

## Version semantics — SemVer-adjacent

A version is **breaking** if any of these change without client
opt-in:

1. A field is removed, renamed, or changes type.
2. An enum value is added (clients must be tolerant, but strict
   clients break).
3. A required request field is added.
4. Response-shape invariants change (array order becomes unstable,
   timestamps change zone, etc.).
5. Error envelope shape changes.
6. Authentication/authorization scope required changes.

Non-breaking (`v1.x` additive) — safe without bumping major:

- Adding an optional response field.
- Adding an optional request field with a default.
- Adding a new endpoint.
- Adding a new optional query parameter.
- Improving internal behavior without changing the contract.

Major version bumps are **rare** — target one per year at most.
Every accepted major needs an ADR with migration steps.

## Route layout

```text
src/routes/api/
  v1/
    orders/
      +server.ts          # pinned v1 handler
      [id]/+server.ts
    schemas.ts            # Zod — frozen
    openapi.json/+server.ts
  v2/
    orders/
      +server.ts
      [id]/+server.ts
    schemas.ts            # Zod — additive or breaking from v1
    openapi.json/+server.ts
  _shared/
    auth.ts               # identity, rate-limit, CORS — version-agnostic
    problem.ts            # RFC 9457 envelope — version-agnostic
    deprecation.ts        # header helper
```

**Three layout rules:**

1. **Don't share Zod schemas across majors.** Copy-paste `schemas.ts`
   into `v2/` and evolve; the temporary duplication is deliberate
   and shows diff clearly in review.
2. **Share cross-cutting middleware** (auth, rate-limit, CORS,
   problem envelope) in `_shared/` — those don't change across
   majors.
3. **Each version publishes its own OpenAPI doc** at
   `/api/vN/openapi.json`. Clients generate types against the
   version they pin.

## Deprecation lifecycle

The lifecycle is three phases. **No version is silently removed.**

```text
Phase A — announced  (v1 still default; v2 available)
Phase B — deprecated (v1 emits Sunset + Deprecation headers; warn)
Phase C — removed    (v1 returns 410 Gone + Link to docs; read-only window optional)
```

Timing: v1 → phase A lasts until v2 is stable (≥30 days); phase B
lasts ≥90 days (6 months for paying-customer endpoints); phase C is
the 410-Gone terminal state with an optional 30-day read-only window
for `GET`s while `POST`/`PUT`/`DELETE` are already 410.

### Deprecation headers (RFC 7234 + RFC 8594)

```ts
// src/routes/api/_shared/deprecation.ts
export type DeprecationInfo = {
  deprecated: true;                  // RFC 7234 Deprecation header
  sunsetAt: Date;                    // RFC 8594 Sunset header
  successorVersion: string;          // e.g. 'v2'
  migrationDoc: string;              // https URL
};

export function applyDeprecationHeaders(
  response: Response,
  info: DeprecationInfo,
): Response {
  response.headers.set('Deprecation', 'true');
  response.headers.set('Sunset', info.sunsetAt.toUTCString());
  response.headers.set(
    'Link',
    [
      `<${info.migrationDoc}>; rel="deprecation"; type="text/html"`,
      `</api/${info.successorVersion}/openapi.json>; rel="successor-version"`,
    ].join(', '),
  );
  return response;
}
```

Every v1 response in Phase B applies these headers. Clients that
follow the RFC see the sunset date; `openapi-fetch` middleware can
surface it as a dev-warn + a production metric emit.

### 410 Gone (Phase C)

After sunset, v1 returns `410 Gone` with RFC 9457 problem+json body
carrying `urn:sveltesentio:api:sunset` type + `migrationDoc` +
`successorVersion` so client error-handling renders a useful message
instead of a bare HTTP status.

```ts
// src/routes/api/v1/orders/+server.ts — after Phase C
import { error } from '@sveltejs/kit';

export async function GET() {
  throw error(410, {
    type: 'urn:sveltesentio:api:sunset',
    title: 'API v1 has been removed',
    status: 410,
    detail: 'API v1 was sunset on 2026-12-31. Use v2.',
    migrationDoc: 'https://docs.acme.example/migrate-v1-to-v2',
    successorVersion: 'v2',
  });
}
```

## Observability — usage-by-version dashboards

Every API request emits an OTel span with bounded version labels.
**Without per-version telemetry, you can't know when it's safe to
remove v1.**

```ts
// src/routes/api/_shared/with-version.ts
import { trace } from '@opentelemetry/api';

export function withApiVersion<T extends (event: unknown) => unknown>(
  version: string,
  deprecated: boolean,
  handler: T,
): T {
  return (async (event) => {
    const span = trace.getActiveSpan();
    span?.setAttributes({
      'api.version': version,              // 'v1' | 'v2' | 'v3'
      'api.deprecated': deprecated,
      'api.route': new URL(event.request.url).pathname.replace(/\d+/g, ':id'),
    });
    return handler(event);
  }) as T;
}
```

**Three observability rules:**

1. **`api.version` is bounded** — the enum is whatever versions you
   ship, never free-form. Metrics-label-safe.
2. **`api.route` strips IDs** (`/api/v1/orders/42` → `/api/v1/orders/:id`)
   so per-route cardinality is bounded by route count, not by
   per-request id.
3. **Track per-client-application, not per-user.** Add `api.client`
   from API-key metadata (not userId) — you need to know *which
   integration* is on v1, so you can email them before sunset. User-
   level is too granular.

Dashboard pattern: top-10 API-key-on-deprecated-version by request
volume → that's your sunset outreach list.

## Client migration path — `openapi-fetch` codegen

Clients consuming your API via `openapi-fetch` per
[http-client.md](http-client.md) pin the version at codegen time:

```ts
// packages/my-app/src/lib/api-client.ts
import createClient from 'openapi-fetch';
import type { paths } from './api-types.v2';   // regenerated from /api/v2/openapi.json

export const api = createClient<paths>({ baseUrl: '/api/v2' });
```

Upgrade = regen-types PR + fix TS errors. The TS-error surface tells
the client exactly what moved, which is the upgrade ergonomic the
URL-segment strategy buys.

## Feature-flag-gated v2 rollout

For high-risk majors, dark-launch v2 behind a flag per
[feature-flags.md](feature-flags.md) — internal team + staged
customers hit v2 first, flag flips to 100% when healthy, v1
deprecation clock starts.

```ts
// src/routes/api/v2/orders/+server.ts
export async function GET({ locals, url }) {
  if (!(await locals.flags.getBooleanValue('api.v2.orders.enabled', false))) {
    throw error(404);   // NOT 503 — the endpoint doesn't exist yet for this caller
  }
  // … v2 handler
}
```

404 not 503, because 503 implies a transient outage; the endpoint
simply isn't released yet to this caller's bucket.

## Backfilling from an unversioned API

If the existing API has no version segment (`/api/orders`), don't
break clients by moving it:

1. **Create `/api/v1/orders`** that re-exports the existing handler
   1:1. Clients can opt in.
2. **Leave `/api/orders` as alias to v1** with a `Deprecation: true`
   + `Sunset` header pointing to `/api/v1/orders`.
3. **Monitor unversioned-path usage.** When it drops below 1%
   across all API keys, remove the alias.
4. **Never introduce `/api/v2` before the unversioned path is
   aliased**; otherwise clients skipping v1 land on v2 without a
   clean pin point.

This migration takes 3-6 months. Don't rush it.

## Testing

Two additional test lanes beyond normal route coverage:

1. **Contract snapshot per version** — an OpenAPI diff test that
   fails if `/api/v1/openapi.json` changes without an ADR. v1 is
   **frozen** once released.
2. **Deprecation-header smoke** — a Playwright test asserting
   `/api/v1/*` responses in Phase B carry `Deprecation`, `Sunset`,
   and the `Link: rel="successor-version"` header.

```ts
// packages/api/test/contract.v1.test.ts
import { describe, expect, test } from 'vitest';
import frozen from './fixtures/openapi.v1.frozen.json';
import current from '../src/routes/api/v1/openapi.snapshot.json';

describe('v1 contract is frozen', () => {
  test('OpenAPI diff matches frozen baseline', () => {
    expect(current).toEqual(frozen);
  });
});
```

A v1 schema change PR must update the frozen fixture AND cite an
ADR — otherwise it's an accidental break.

## Anti-patterns

- **Don't version implicitly by header default.** A `GET /orders`
  with no `Accept: ...v2+json` that quietly returns v2 shape because
  you flipped a server default breaks every pinned client. Version
  opt-in must be explicit.
- **Don't mix version strategies.** If URL-segment is the default,
  never also accept `Accept-Version:` as an override — now the
  effective version is a product of two inputs and the cache matrix
  doubles.
- **Don't remove v1 without Phase B headers.** A surprise 410 is
  how integrations break at 03:00. Sunset + Deprecation headers
  exist so clients can monitor deprecation *before* it's terminal.
- **Don't double-maintain forever.** Every live version is a
  surface-area tax. Set a sunset date at Phase A announcement; hold
  it unless a named customer formally requests extension.
- **Don't bump major for non-breaking changes.** Adding an optional
  field is `v1.x`, not `v2`. Reserving major bumps for real breaks
  keeps the signal meaningful.
- **Don't share Zod schemas across majors via import.** A "shared
  types" refactor one year in will silently break v1 when someone
  evolves the shared type. Copy-paste is the invariant.
- **Don't expose only `/api/v1` when you're on v2.** If v1 is
  deprecated and v2 is default, the canonical URL should redirect
  new docs → v2. Old docs linking to v1 is fine; new docs linking
  to v1 encodes sunset confusion.
- **Don't version by subdomain (`v1.api.acme.example`) by default.**
  CORS matrix grows, cookie domain matrix grows, and a path-aware
  proxy setup is simpler than subdomain DNS juggling unless you
  have specific caching/CDN requirements.
- **Don't version database schemas in lockstep.** The API contract
  is the public surface; the DB is internal. A single DB schema
  serves v1 and v2 simultaneously via different route handlers.
- **Don't rely on "my API has no external clients".** The second you
  ship a mobile app, an OAuth integration, a webhook subscriber, or
  a public partner, you have external clients. Version from day one
  — adding `/api/v1` later is cheap; un-versioning an unversioned
  path is the 3-6 month migration above.
- **Don't ship breaking changes in `v1.x` "just this once".** Every
  exception becomes the rule. If it's breaking, it's `v2`.
- **Don't announce sunset without observability.** "v1 sunset in 90
  days" requires "I know who's on v1" — without `api.version` + 
  `api.client` telemetry, you're guessing.

## References

- [ADR-0019 — Structured error envelope (RFC 9457)](../adr/0019-structured-error-envelope.md)
- [principles.md §2.7 — SemVer + release discipline](../principles.md)
- Sibling recipes: [http-client.md](http-client.md),
  [schemas.md](schemas.md),
  [observability.md](observability.md),
  [feature-flags.md](feature-flags.md),
  [webhooks.md](webhooks.md),
  [monorepo-releases.md](monorepo-releases.md).
- Upstream specs:
  - RFC 8594 — The Sunset HTTP Header Field: <https://www.rfc-editor.org/rfc/rfc8594>
  - RFC 7234 — HTTP Caching (Deprecation header): <https://www.rfc-editor.org/rfc/rfc7234>
  - RFC 9457 — Problem Details for HTTP APIs: <https://www.rfc-editor.org/rfc/rfc9457>
  - OpenAPI 3.1 spec: <https://spec.openapis.org/oas/v3.1.0>
  - Zalando RESTful API guidelines (versioning): <https://opensource.zalando.com/restful-api-guidelines/#versioning>
