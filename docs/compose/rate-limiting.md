# Rate limiting — Redis token-bucket + RFC 6585 / RFC 9457 mapping

Rate limiting is the cheapest, most-effective DoS mitigation available
to a web app. Without it, a single misbehaving client (intentional or
not) can saturate your server, your downstream APIs, your billing, and
your on-call rotation. With it, the same client gets a clean 429 with
a `Retry-After` header and your backend stays up.

This recipe is the SvelteKit `+server.ts` pattern: a Redis-backed
token-bucket (or sliding-window) middleware running in `hooks.server.ts`,
keyed on the right identity layer per route, returning RFC 6585 status
429 with `Retry-After` + `RateLimit-*` headers (RFC 9530), and mapping
the body through the framework's RFC 9457 problem+json shape per
[http-client.md](http-client.md).

## Related

- [http-client.md](http-client.md) — RFC 9457 problem shape; 429
  response body uses `urn:sveltesentio:rate:limited`.
- [auth-oidc.md](auth-oidc.md) — authenticated requests rate-limit by
  `userId`; anonymous by IP.
- [cookies-authoritative.md](cookies-authoritative.md) — anonymous
  bucket cookie (UUIDv7) is more accurate than IP for shared NAT.
- [observability.md](observability.md) — `rate.limit.outcome` enum
  span attribute (`allowed`/`limited`/`shadowed`); per-route counters.
- [opentelemetry-logs.md](opentelemetry-logs.md) — limit hits emit
  `WARN`-severity log records (not `ERROR` — limits are normal).
- [webhooks.md](webhooks.md) — inbound webhooks **never** rate-limit
  on IP (provider IPs are trusted bursty); skip-list pattern.
- [ai-streaming.md](ai-streaming.md) — AI endpoints get a separate
  bucket with stricter limits (per-user-day token cap).
- [ai-vercel-sdk-agents.md](ai-vercel-sdk-agents.md) — agent loops
  burn 5-20× cost; separate bucket from chat.
- [background-sync.md](background-sync.md) — replayed offline
  requests can spike rate at reconnect; tune burst capacity.
- [principles.md §2.2](../principles.md) — OWASP ASVS L2 V11
  (Anti-automation).

## When this recipe applies

```text
Public unauthenticated endpoint                                       → mandatory (IP + cookie-bucket)
Authenticated mutating endpoint (POST/PUT/PATCH/DELETE)               → mandatory (userId)
Authenticated read endpoint                                           → mandatory but generous
Login / password-reset / signup / OTP-send / passkey-challenge        → mandatory + STRICT (anti-credential-stuffing)
AI endpoints                                                          → separate bucket, per-user-day token cap
Webhook receivers                                                     → skip provider IP allowlist; rate-limit other clients
Server-to-server with mTLS                                            → optional; mTLS auth gate suffices
GET /api/health                                                       → exempt (or very generous)
WebSocket upgrade / SSE connect                                       → rate-limit the connect; not per-message
```

Three rules: (a) the **right identity layer** beats clever algorithms
— rate-limiting on IP behind a corporate NAT or mobile-carrier CGNAT
punishes innocent users; (b) the **right bucket per route** beats one
global bucket — login is 5/min, search is 60/min, AI is 10/min; (c)
**fail-open** when Redis is down — a rate-limiter outage cannot 5xx
your app; log + allow.

## Algorithm — token-bucket vs sliding-window

```text
Algorithm           When to pick                                                           Cost
Token-bucket        Burst-tolerant traffic (UI clicks, search-as-you-type)                 1 Redis op (Lua-atomic)
Sliding-window log  Strict per-period count (compliance: "≤100 requests/hour"), low-vol   2-3 Redis ops + ZSET memory
Sliding-window cnt  High-volume + reasonable accuracy                                      1 Redis op (atomic INCR)
Fixed-window cnt    Don't                                                                  Cheap but allows 2× burst at window edge
Leaky-bucket        Smoothing outbound traffic (you call upstream)                         More state; rarely worth it
```

Default to **token-bucket** for inbound HTTP — it tolerates bursts
(human clicks come in clusters), refills smoothly, and is one
Lua-atomic Redis operation. Reserve sliding-window-log for compliance
"max N per hour" where the precise count matters more than burst
tolerance.

## Install

```bash
pnpm -F @sveltesentio/core add ioredis@^5
```

`ioredis` over `node-redis` for the cleaner pipeline + Lua API; both
work. No dedicated rate-limit lib (`express-rate-limit`/`rate-limiter-flexible`)
— they ship 100s of KB of options for what's a 30-line Lua script and
a thin TypeScript wrapper, and we want full control over the response
shape per [http-client.md](http-client.md).

## Shape — token-bucket Lua + middleware

```lua
-- src/lib/rate-limit/token-bucket.lua
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'updated_ms')
local tokens = tonumber(data[1]) or capacity
local updated_ms = tonumber(data[2]) or now_ms

local elapsed_sec = math.max(0, (now_ms - updated_ms) / 1000)
tokens = math.min(capacity, tokens + elapsed_sec * refill_per_sec)

local allowed = 0
local retry_after_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after_ms = math.ceil((cost - tokens) / refill_per_sec * 1000)
end

redis.call('HMSET', key, 'tokens', tokens, 'updated_ms', now_ms)
redis.call('PEXPIRE', key, math.ceil(capacity / refill_per_sec * 1000) + 60000)
return { allowed, math.floor(tokens), retry_after_ms }
```

```ts
// src/lib/rate-limit/redis-bucket.ts
import { redis } from '$lib/redis';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT = readFileSync(fileURLToPath(new URL('./token-bucket.lua', import.meta.url)), 'utf8');
const SHA = await redis.script('LOAD', SCRIPT) as string;

export type BucketConfig = {
  capacity: number;
  refillPerSec: number;
  cost?: number;
};

export type BucketResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  capacity: number;
  refillPerSec: number;
};

export async function consume(key: string, cfg: BucketConfig): Promise<BucketResult> {
  const cost = cfg.cost ?? 1;
  const result = await redis.evalsha(SHA, 1, key, cfg.capacity, cfg.refillPerSec, Date.now(), cost) as [number, number, number];
  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2],
    capacity: cfg.capacity,
    refillPerSec: cfg.refillPerSec,
  };
}
```

Five bucket invariants:

- **Lua-atomic** — read-modify-write in one round-trip, no lost-update
  race when two requests hit the same key concurrently.
- **Refill computed from elapsed wall-clock** — not from a polling
  loop; bucket "refills" on read, no background process needed.
- **`PEXPIRE` covers refill window + buffer** — keys disappear after
  inactivity; no manual cleanup. Buffer (60s) absorbs clock skew.
- **`evalsha` with cached SHA** — script ships once, hot path is one
  network round-trip with the cached hash.
- **Cost per request defaults to 1** — endpoint can pass `cost: 5` for
  expensive operations (AI inference, large file upload) so cheap
  endpoints aren't starved.

## Identity layer — the most important decision

```ts
// src/lib/rate-limit/identity.ts
export function rateLimitKey(event: RequestEvent, scope: string): string {
  const session = event.locals.session;
  if (session?.userId) return `rl:${scope}:user:${session.userId}`;

  const cookieBucket = event.cookies.get('flag-bucket');
  if (cookieBucket) return `rl:${scope}:cookie:${cookieBucket}`;

  const ip = event.getClientAddress();
  return `rl:${scope}:ip:${ip}`;
}
```

Three identity rules:

- **`userId` first** — authenticated, stable, fair. One user can't
  punish another behind the same NAT.
- **Cookie-bucket second** — UUIDv7 cookie (same as
  [feature-flags.md](feature-flags.md) bucket-pin, or a dedicated
  `__Host-rl-anon`); survives across requests, doesn't conflate users
  on shared IP.
- **IP last, with caveats** — corporate NAT and mobile CGNAT can put
  10,000 users behind one IP. IP-only rate limiting on a login endpoint
  blocks legitimate users when one attacker is brute-forcing. Pair IP
  with cookie-bucket for unauthenticated; trust `event.getClientAddress()`
  only after configuring SvelteKit `clientAddress` per
  `kit.config.js` proxy headers.

## Per-route configuration

```ts
// src/lib/rate-limit/policies.ts
export const policies = {
  default:        { capacity: 60,  refillPerSec: 1.0  },
  login:          { capacity: 5,   refillPerSec: 0.0167 },
  signup:         { capacity: 3,   refillPerSec: 0.0083 },
  passwordReset:  { capacity: 3,   refillPerSec: 0.0083 },
  passkeyChallenge:{ capacity: 10, refillPerSec: 0.0833 },
  search:         { capacity: 30,  refillPerSec: 0.5  },
  aiChat:         { capacity: 10,  refillPerSec: 0.0833 },
  aiAgent:        { capacity: 3,   refillPerSec: 0.0167, cost: 1 },
  upload:         { capacity: 20,  refillPerSec: 0.1, cost: 2 },
  webhookReceive: { capacity: 1000, refillPerSec: 100 },
} as const satisfies Record<string, BucketConfig>;

export type PolicyName = keyof typeof policies;
```

Five policy rules:

- **`refillPerSec` is the sustained rate**; `capacity` is the burst.
  Login at 5-burst + 1/min refill = "5 attempts then 1/min".
- **AI cost-multiplier inheritance** — agent endpoints have lower
  capacity AND can pass higher per-call `cost`; both controls.
- **Auth endpoints are 10-100× stricter** than read endpoints —
  credential stuffing is the #1 abuse vector.
- **Webhook receive is generous** — provider retries are bursty by
  design; throttling them triggers cascading retries.
- **Don't make policies route-template-specific without grouping** —
  100 routes with bespoke policies is unmaintainable; group by behaviour
  class (read/mutate/auth/AI/upload/webhook).

## Middleware — `hooks.server.ts` integration

```ts
// src/lib/rate-limit/hook.ts
import type { Handle } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { consume } from './redis-bucket';
import { rateLimitKey } from './identity';
import { policies, type PolicyName } from './policies';
import { logger } from '$lib/observability/logs';
import { SeverityNumber } from '@opentelemetry/api-logs';

export const rateLimitHook: Handle = async ({ event, resolve }) => {
  const policy = pickPolicy(event);
  if (!policy) return resolve(event);

  const key = rateLimitKey(event, policy.scope);
  let result;
  try {
    result = await consume(key, { ...policies[policy.name], cost: policy.cost });
  } catch (err) {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      body: 'rate-limiter unavailable; failing open',
      attributes: { 'rate.policy': policy.name, 'correlation.id': event.locals.correlationId },
    });
    return resolve(event);
  }

  const headers = {
    'RateLimit-Limit': String(result.capacity),
    'RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'RateLimit-Reset': String(Math.ceil(result.retryAfterMs / 1000)),
    'RateLimit-Policy': `${result.capacity};w=${Math.ceil(result.capacity / result.refillPerSec)}`,
  };

  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        type: 'urn:sveltesentio:rate:limited',
        title: 'Too many requests',
        status: 429,
        detail: `Retry after ${Math.ceil(result.retryAfterMs / 1000)}s`,
      }),
      {
        status: 429,
        headers: {
          ...headers,
          'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
          'content-type': 'application/problem+json',
        },
      },
    );
  }

  const response = await resolve(event);
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
};
```

Six middleware invariants:

- **Try/catch around `consume` + log + `return resolve(event)`** —
  fail-open on Redis outage. Failing closed turns "Redis is down" into
  "site is down".
- **`Retry-After` in seconds**, not ms — RFC 7231 spec; clients (and
  CDNs) parse seconds.
- **`RateLimit-*` draft headers** (RFC 9530) — `RateLimit-Limit`,
  `-Remaining`, `-Reset`, `-Policy`; informational, lets clients
  back-off voluntarily before hitting 429.
- **RFC 9457 problem+json body** per
  [http-client.md](http-client.md) — `type` URI is grep-able.
- **Headers on **both** allow and deny paths** — clients need
  `Remaining` to throttle proactively; only emitting on 429 is too late.
- **`pickPolicy` is data-driven** — route-table mapping path prefix to
  policy name; not 50 if/else.

## Route-policy mapping

```ts
// src/lib/rate-limit/routes.ts
import type { RequestEvent } from '@sveltejs/kit';
import type { PolicyName } from './policies';

const RULES: Array<{ test: (e: RequestEvent) => boolean; policy: PolicyName; scope: string; cost?: number }> = [
  { test: (e) => e.url.pathname.startsWith('/api/auth/login'),       policy: 'login',          scope: 'login' },
  { test: (e) => e.url.pathname.startsWith('/api/auth/signup'),      policy: 'signup',         scope: 'signup' },
  { test: (e) => e.url.pathname.startsWith('/api/auth/reset'),       policy: 'passwordReset',  scope: 'reset' },
  { test: (e) => e.url.pathname.startsWith('/api/auth/passkey'),     policy: 'passkeyChallenge',scope: 'passkey' },
  { test: (e) => e.url.pathname.startsWith('/api/ai/agent'),         policy: 'aiAgent',        scope: 'ai-agent' },
  { test: (e) => e.url.pathname.startsWith('/api/ai/'),              policy: 'aiChat',         scope: 'ai-chat' },
  { test: (e) => e.url.pathname.startsWith('/api/uploads/'),         policy: 'upload',         scope: 'upload' },
  { test: (e) => e.url.pathname.startsWith('/api/webhooks/'),        policy: 'webhookReceive', scope: 'webhook' },
  { test: (e) => e.url.pathname === '/api/health',                   policy: null as never,    scope: '' },
  { test: (e) => e.url.pathname.startsWith('/api/'),                 policy: 'default',        scope: 'default' },
];

export function pickPolicy(event: RequestEvent) {
  for (const rule of RULES) {
    if (rule.test(event)) return rule.policy ? { name: rule.policy, scope: rule.scope, cost: rule.cost } : null;
  }
  return null;
}
```

Two routing rules:

- **Most-specific first** — `/api/ai/agent` matches before `/api/ai/`.
- **`/api/health` exempt** — load-balancer health probes hit it
  hundreds of times per minute; rate-limiting health is a
  self-inflicted outage.

## Webhook IP allowlist — never rate-limit provider retries

```ts
// src/lib/rate-limit/webhook-allowlist.ts
const STRIPE_IPS = ['3.18.12.63', /* ... see https://stripe.com/files/ips/ips_webhooks.json ... */];

export function isWebhookProvider(ip: string): boolean {
  return STRIPE_IPS.includes(ip) || isGitHubWebhookIp(ip);
}
```

Per [webhooks.md](webhooks.md): provider retries spike on outage
recovery (50× normal volume in a 5-min burst). If the provider IP isn't
allowlisted from rate-limiting, you 429 their retries, they retry
harder, you 429 more — cascading failure. Allowlist by provider's
published IP ranges (Stripe, GitHub, Slack all publish theirs).

Pair with the HMAC verification: rate-limit-exempt **and**
signature-verified is the contract. IP-allowlist alone is not
authentication.

## Distributed-Redis caveats

```text
Single Redis instance      → simplest; fine for <10k req/s; SPOF
Redis Sentinel             → HA; failover transparent to ioredis client
Redis Cluster              → horizontal scale; key-tag your bucket keys to keep hash-slots aligned
Upstash / Cloudflare KV    → serverless-edge-compatible; eventual consistency edge-cases
```

Three Redis-distribution rules:

- **Single instance is fine for v0.1** — token-bucket Lua is one round
  trip; ~50µs latency on local Redis. Don't over-engineer.
- **Cluster requires hash-tagging** — keys like `rl:{login}:user:abc`
  with `{login}` as the hash tag keep bucket reads on one shard;
  mis-tagging causes cross-shard MULTI errors.
- **Edge-KV (Cloudflare KV, Upstash REST) is eventually consistent**
  — token-bucket on edge-KV allows burst-multiply across regions
  during the consistency window. Acceptable for soft limits, not for
  credential-stuffing prevention.

## Observability

```ts
import { trace, metrics } from '@opentelemetry/api';

const tracer = trace.getTracer('rate-limit');
const limitedCounter = metrics.getMeter('rate-limit').createCounter('rate.limit.outcome');

const span = tracer.startSpan('rate.limit.check', {
  attributes: {
    'rate.policy': policy.name,
    'rate.scope': policy.scope,
    'rate.outcome': result.allowed ? 'allowed' : 'limited',
  },
});
limitedCounter.add(1, {
  policy: policy.name,
  outcome: result.allowed ? 'allowed' : 'limited',
});
span.end();
```

Per [observability.md](observability.md): `rate.policy` and
`rate.outcome` are bounded enums; `rate.scope` is bounded (login,
signup, ai-chat, ...). The actual identity (`userId`, IP) **never**
goes on a metric label — cardinality explosion. For per-user diagnosis,
the trace span carries identity (high-cardinality span attributes are
fine; metric labels are not).

## Shadow mode — observing before enforcing

```ts
// src/lib/rate-limit/shadow.ts
const SHADOW = (event: RequestEvent) => event.url.searchParams.has('rl_shadow');

if (!result.allowed) {
  if (SHADOW(event)) {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      body: 'rate-limit would have blocked',
      attributes: { 'rate.policy': policy.name, /* ... */ },
    });
    return resolve(event);
  }
  // ... return 429 ...
}
```

Roll out new policies in shadow mode first: the limiter computes the
decision and emits `WARN` logs but still allows. After a sprint of
metrics review (false-positive rate, peak hit rate), flip to enforcing.
This is the equivalent of CSP Report-Only from
[trusted-types.md](trusted-types.md).

## Client-side handling

```ts
// src/lib/http/retry-after.ts
export async function withRetry(req: () => Promise<Response>, attempts = 3): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    const res = await req();
    if (res.status !== 429) return res;
    const retryAfter = Number(res.headers.get('Retry-After') ?? '1');
    if (i === attempts - 1) return res;
    await sleep(Math.min(retryAfter, 30) * 1000 + Math.random() * 250);
  }
  throw new Error('unreachable');
}
```

Three client rules:

- **Honour `Retry-After`** — server told you when to come back; obey
  exactly. Rolling your own backoff defeats the limiter.
- **Cap retry attempts at 3** — beyond that, surface the error to the
  user; infinite retries make the limit-hit invisible to humans.
- **Add jitter** — synchronised retries from many clients re-saturate
  the limiter on the same tick; small random offset desynchronises.

## Testing

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { consume } from './redis-bucket';

describe('token bucket', () => {
  beforeEach(async () => { await redis.flushdb(); });

  it('allows up to capacity then limits', async () => {
    const cfg = { capacity: 3, refillPerSec: 0.1 };
    expect((await consume('test', cfg)).allowed).toBe(true);
    expect((await consume('test', cfg)).allowed).toBe(true);
    expect((await consume('test', cfg)).allowed).toBe(true);
    const fourth = await consume('test', cfg);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over wall-clock time', async () => {
    vi.useFakeTimers();
    const cfg = { capacity: 1, refillPerSec: 1 };
    expect((await consume('refill', cfg)).allowed).toBe(true);
    expect((await consume('refill', cfg)).allowed).toBe(false);
    vi.advanceTimersByTime(1100);
    expect((await consume('refill', cfg)).allowed).toBe(true);
  });
});
```

Use a real Redis (testcontainers or `ioredis-mock`); the Lua atomicity
is the thing under test. Pair with [clock-injection.md](clock-injection.md)
patterns for time-based assertions; the Lua script reads `Date.now()`
from the caller, so injecting a clock at the TS boundary covers it.

## Anti-patterns

- **Failing closed on Redis outage** — rate-limiter outage = site
  outage; always fail-open with a `WARN` log.
- **IP-only rate limiting on auth endpoints** — corporate NAT / mobile
  CGNAT punishes innocent users; pair with cookie-bucket.
- **Trusting `request.headers.get('x-forwarded-for')` directly** — easy
  to spoof; use `event.getClientAddress()` after configuring SvelteKit
  proxy-trust correctly.
- **Per-route bespoke policies** — 100 routes × bespoke = unmaintainable;
  group by behaviour class.
- **Same bucket scope across endpoint classes** — exhausting "default"
  on search blocks login; per-scope keys.
- **No `Retry-After` header** — clients can't back off correctly; they
  retry immediately and re-hit the limit.
- **`Retry-After` in milliseconds** — spec is seconds; CDNs and HTTP
  clients parse seconds.
- **5xx instead of 429** — clients retry; your monitoring confuses
  rate-limited traffic with backend errors.
- **No problem+json body** — opaque "Too many requests" string; client
  can't distinguish from generic 429.
- **Identity / IP on metric labels** — cardinality explosion; spans
  ok, metrics no.
- **Allow-listing webhook IPs without HMAC verify** — IP allowlist is
  not authentication; signature still mandatory per
  [webhooks.md](webhooks.md).
- **Rate-limiting `/api/health`** — load-balancer probes 429 → marked
  unhealthy → traffic shifts → cascading outage.
- **No shadow-mode rollout** — new policy with wrong tuning blocks
  legitimate users on day 1.
- **Counting WebSocket messages instead of connects** — chat traffic
  is one connect, hundreds of messages; rate-limit the connect.
- **Rate-limiting before authenticating** — for high-cost auth
  flows you can; but for routes that need session, evaluate
  authentication first so the bucket key uses `userId`.
- **Per-process in-memory bucket** — multi-instance deploys =
  per-instance limits; user multiplies effective limit by instance
  count. Use shared Redis.
- **Burst capacity = 1** — every UI double-click is rate-limited;
  capacity is the burst budget, refill is the sustained rate.
- **Same policy in dev + prod** — dev hot-reload triggers
  rapid-fire requests; bump dev capacity 10× or skip for `localhost`.
- **AI endpoints sharing chat bucket with agent bucket** — agents
  burn 5-20× cost; shared bucket starves either or both.
- **Setting cookies in the 429 response** — pollutes downstream caches
  and blurs rate-limit telemetry.
- **No alerting on `rate.outcome=limited` rate** — sustained limit-hits
  signal abuse OR a misconfigured policy; alert above a baseline
  threshold.

## References

- [RFC 6585 — Additional HTTP Status Codes (429)](https://datatracker.ietf.org/doc/html/rfc6585)
- [RFC 9457 — Problem Details](https://datatracker.ietf.org/doc/html/rfc9457)
- [RFC 9530 — RateLimit Headers (draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
- [RFC 7231 — `Retry-After`](https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.3)
- [Stripe webhook IPs](https://stripe.com/files/ips/ips_webhooks.json)
- [GitHub Meta API](https://docs.github.com/en/rest/meta/meta)
- [OWASP — Anti-Automation](https://owasp.org/www-project-application-security-verification-standard/)
- [Cloudflare — Rate limiting concepts](https://developers.cloudflare.com/waf/rate-limiting-rules/)
