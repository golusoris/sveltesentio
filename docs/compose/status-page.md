# status-page.md — composition recipe

> **Public status page + uptime history + subscribe-to-updates.**
> Separate from [incident-response.md](incident-response.md) (which
> covers internal declaration + on-call + post-mortem); this recipe
> is the **customer-facing surface**. Driven from the same incident
> record but rendered on an **independent deployment target** so a
> main-site outage doesn't black out the status page. Per
> [ADR-0019](../adr/0019-http-client-and-error-model.md) no
> proprietary data leaks via component names; per
> [ADR-0023](../adr/0023-compliance-audit-log-contract.md) every
> status mutation is audit-logged.

> **The isolation rule.** If your status page renders from the same
> Postgres that just went down, users see a blank page during the
> outage. Isolate: separate subdomain, separate deployment, separate
> DB (or a read replica + static-fallback cache), separate edge
> provider.

## Related

- [incident-response.md](incident-response.md) — status page consumes
  incident records; declaration flow is there
- [observability.md](observability.md) — health checks drive
  auto-detection that proposes incidents
- [multi-region-deployment.md](multi-region-deployment.md) — regional
  status rolls up into the page
- [structured-emails.md](structured-emails.md) — subscriber email
  channel
- [webhooks-outbound.md](webhooks-outbound.md) — subscriber webhook
  channel for status changes
- [audit-log.md](audit-log.md) — every publish / update / resolve
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — status page
  localized per subscriber preference
- [caching.md](caching.md) — the page is heavily cached; cache bust
  on every status mutation
- [rate-limiting.md](rate-limiting.md) — subscribe endpoint is
  rate-limited; attackers use it for email enumeration
- [ADR-0019](../adr/0019-http-client-and-error-model.md),
  [ADR-0023](../adr/0023-compliance-audit-log-contract.md)

## When to use what

```text
Public-facing SaaS > 100 customers            → this recipe
                                                Dedicated status domain
Internal-only app / small customer base        → Slack channel / email list
                                                This recipe overkill
Enterprise contract with SLA credits           → this recipe + API access
                                                Customers pull uptime for SLA
Multi-region product                           → this recipe + per-region roll-up
                                                Components include "API - EU", "API - US"
Multi-tenant with tenant-specific incidents    → dual model:
                                                public page for shared infra,
                                                in-app banner for tenant-specific
Third-party (status.io, statuspage.com)         → OK for day 1; migrate when you want
                                                per-tenant visibility or SLA-credit flow
Status-only-during-incident                    → unacceptable; always-on is the point
                                                "no news is good news" page is fine
```

## Components model

```text
Service (what users depend on)          Examples
─────────────────────────────────────   ─────────────────────────────
API (multi-tenant app)                  "App API - US", "App API - EU"
Ingest pipeline                         "Event Ingest", "Webhooks Delivery"
Realtime                                "WebSocket", "Presence"
Authentication                          "Sign-in", "Password Reset"
Background jobs                         "Scheduled Jobs", "Email Delivery"
Admin surfaces                          "Admin UI"
Third-party dependencies                "Stripe", "Auth0", "S3 (us-east-1)"
```

Third-party deps on the page are **honest transparency** — users
should know when their payment failures are your vendor, not you.

## Shape — bounded Zod

```ts
// packages/status/src/types.ts
import { z } from 'zod';

export const ComponentStatus = z.enum([
  'operational',
  'degraded_performance',
  'partial_outage',
  'major_outage',
  'under_maintenance',
]);
export type ComponentStatus = z.infer<typeof ComponentStatus>;

export const Component = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  displayName: z.string().min(1).max(60),
  description: z.string().max(280).nullable(),
  group: z.string().max(40).nullable(),             // optional grouping: "Core API", "Data"
  region: z.string().regex(/^[a-z0-9-]{2,20}$/).nullable(),
  status: ComponentStatus,
  orderIndex: z.number().int().min(0).max(1000),
  showOnPublic: z.boolean().default(true),
});
export type Component = z.infer<typeof Component>;

export const IncidentImpact = z.enum(['none', 'minor', 'major', 'critical']);

export const PublicIncident = z.object({
  id: z.string().uuid(),                             // matches internal incident id
  title: z.string().min(8).max(120),
  impact: IncidentImpact,
  currentStatus: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'scheduled']),
  startedAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  affectedComponentIds: z.array(z.string().uuid()).min(1).max(50),
  // Only publicly-shareable subset of timeline entries.
  updates: z.array(z.object({
    id: z.string().uuid(),
    kind: z.enum(['investigating', 'identified', 'monitoring', 'resolved', 'comment']),
    message: z.string().min(1).max(2000),
    at: z.string().datetime({ offset: true }),
    author: z.string().max(60).optional(),           // "Platform Team" not individual names
  })).min(1).max(100),
});
export type PublicIncident = z.infer<typeof PublicIncident>;

export const Subscriber = z.object({
  id: z.string().uuid(),
  kind: z.enum(['email', 'webhook', 'sms']),
  email: z.string().email().nullable(),
  webhookUrl: z.string().url().nullable(),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable(),
  componentIds: z.array(z.string().uuid()).max(50),  // empty = all
  confirmedAt: z.string().datetime({ offset: true }).nullable(),
  confirmationToken: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  unsubscribeToken: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  createdAt: z.string().datetime({ offset: true }),
});
export type Subscriber = z.infer<typeof Subscriber>;
```

## Reference pattern

### 1. Deployment isolation

```text
status.sveltesentio.com            ← this page
  └─ separate Vercel/Cloudflare project
  └─ reads from status-DB read-replica OR static JSON in S3+CDN
  └─ NO shared auth, NO shared DB primary, NO shared Redis

app.sveltesentio.com                ← main app
  └─ writes to status via internal API (webhook-style)
```

Simplest pragmatic setup: the status page is a separate **SvelteKit
app** deployed to a different provider (Netlify instead of the
primary Vercel, or Cloudflare Workers), reading a **public S3 object**
(`s3://status/<region>/state.json`) that's written by the main app
on every status mutation. If every other piece of infra is down, S3
+ CDN almost certainly isn't.

### 2. State write path

```ts
// packages/status/src/publish.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Component, PublicIncident } from './types';
import { createHash } from 'node:crypto';

const s3 = new S3Client({ region: env.STATUS_S3_REGION });

export async function publishStatusSnapshot() {
  const components = await loadPublicComponents();
  const activeIncidents = await loadActivePublicIncidents();
  const scheduledMaintenance = await loadScheduledMaintenance();
  const recentHistory = await loadRecentHistory(90);  // 90-day uptime window

  const snapshot = {
    generatedAt: new Date().toISOString(),
    components: components.map((c) => Component.parse(c)),
    incidents: { active: activeIncidents, scheduled: scheduledMaintenance },
    history: recentHistory,
  };
  const body = JSON.stringify(snapshot);
  const etag = createHash('sha256').update(body).digest('hex').slice(0, 16);

  await s3.send(new PutObjectCommand({
    Bucket: env.STATUS_BUCKET,
    Key: 'state.json',
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=30, s-maxage=30',
    ACL: 'public-read',
    Metadata: { etag },
  }));

  await invalidateCdn('/state.json');
  await writeAuditEvent({
    kind: 'status.snapshot.published',
    subjectId: 'system',
    payload: { etag, components: components.length, activeIncidents: activeIncidents.length },
  });
}
```

Short CDN cache (`30s`) balances freshness vs. cost. Hard cache-bust
on every snapshot publish ensures a new incident doesn't wait for
TTL to expire.

### 3. Status-page read path

```ts
// status-page-app/src/routes/+page.server.ts
export async function load({ fetch }) {
  const res = await fetch('https://status-cdn.sveltesentio.com/state.json', {
    headers: { 'cache-control': 'no-cache' },
  });
  if (!res.ok) {
    // Fallback: show a "we're still here" message from a committed
    // static JSON. Never a blank page.
    return { snapshot: STATIC_FALLBACK, degraded: true };
  }
  return { snapshot: await res.json(), degraded: false };
}
```

The fallback `STATIC_FALLBACK` is committed — a stale-but-honest
state ("Unable to load live status; operating from last known
snapshot from 2026-04-15") beats a blank page during an edge outage.

### 4. Public page layout

```svelte
<!-- status-page-app/src/routes/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const overall = $derived.by(() => {
    const c = data.snapshot.components;
    if (c.some((x: any) => x.status === 'major_outage')) return 'major';
    if (c.some((x: any) => x.status === 'partial_outage')) return 'partial';
    if (c.some((x: any) => x.status === 'degraded_performance')) return 'degraded';
    if (c.some((x: any) => x.status === 'under_maintenance')) return 'maintenance';
    return 'operational';
  });
</script>

<svelte:head>
  <title>System status — {overall === 'operational' ? 'All systems operational' : overall}</title>
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="https://status.sveltesentio.com" />
  <link rel="alternate" type="application/json" href="/state.json" />
  <link rel="alternate" type="application/atom+xml" title="Status updates" href="/feed.atom" />
</svelte:head>

<header class="banner banner-{overall}" role="status" aria-live="polite">
  {#if overall === 'operational'}
    <h1>All systems operational</h1>
  {:else if overall === 'maintenance'}
    <h1>Scheduled maintenance in progress</h1>
  {:else}
    <h1>{overall === 'major' ? 'Major outage' : overall === 'partial' ? 'Partial outage' : 'Degraded performance'}</h1>
  {/if}
</header>

{#if data.snapshot.incidents.active.length > 0}
  <section aria-labelledby="active-incidents">
    <h2 id="active-incidents">Active incidents</h2>
    {#each data.snapshot.incidents.active as incident (incident.id)}
      <article aria-labelledby={`inc-${incident.id}-h`}>
        <h3 id={`inc-${incident.id}-h`}>{incident.title}</h3>
        <p>Started {incident.startedAt} · Impact: {incident.impact}</p>
        <ol reversed>
          {#each incident.updates as u (u.id)}
            <li>
              <time datetime={u.at}>{new Date(u.at).toLocaleString()}</time>
              <strong>{u.kind}</strong>
              <p>{u.message}</p>
            </li>
          {/each}
        </ol>
      </article>
    {/each}
  </section>
{/if}

<section aria-labelledby="components">
  <h2 id="components">Components</h2>
  <ul class="components">
    {#each data.snapshot.components as c (c.id)}
      <li class="status-row">
        <span class="name">{c.displayName}</span>
        {#if c.description}<span class="desc">{c.description}</span>{/if}
        <span class="status status-{c.status}" aria-label="Status: {c.status}">
          {c.status.replace(/_/g, ' ')}
        </span>
      </li>
    {/each}
  </ul>
</section>

<section aria-labelledby="history">
  <h2 id="history">90-day uptime</h2>
  <!-- Per-component 90-dot history grid. -->
</section>

<section aria-labelledby="subscribe">
  <h2 id="subscribe">Subscribe to updates</h2>
  <form method="POST" action="/subscribe" use:enhance>
    <label>
      Email
      <input type="email" name="email" required autocomplete="email" />
    </label>
    <button>Subscribe</button>
  </form>
  <p>
    Also available: <a href="/feed.atom">Atom feed</a> ·
    <a href="/webhook">Webhook subscription</a>
  </p>
</section>
```

### 5. Subscribe flow — double-opt-in

```ts
// status-page-app/src/routes/subscribe/+server.ts
import { randomBytes } from 'node:crypto';
import { enqueueConfirmationEmail } from '$lib/server/email';

export async function POST({ request }) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return new Response(null, { status: 400 });

  // Rate-limit per IP — email enumeration attack otherwise.
  if (!(await allowSubscribe(getClientAddress()))) {
    return new Response(null, { status: 429 });
  }

  const confirmationToken = randomBytes(24).toString('base64url');
  const unsubscribeToken = randomBytes(24).toString('base64url');
  await upsertSubscriber({
    id: crypto.randomUUID(),
    kind: 'email',
    email,
    webhookUrl: null,
    phoneE164: null,
    componentIds: [],
    confirmedAt: null,
    confirmationToken,
    unsubscribeToken,
    createdAt: new Date().toISOString(),
  });

  await enqueueConfirmationEmail({
    to: email,
    confirmUrl: `https://status.sveltesentio.com/confirm/${confirmationToken}`,
  });

  // Always return success, to prevent email enumeration.
  // (Even if the email was already subscribed — don't leak.)
  return new Response(null, { status: 202 });
}
```

**Always return 202 regardless of email-existence** — otherwise
attackers iterate addresses and discover which ones are subscribed.

### 6. Notification fanout

```ts
// packages/status/src/notify.ts
export async function notifySubscribers(incident: PublicIncident, update: PublicIncident['updates'][number]) {
  const subs = await loadConfirmedSubscribersForComponents(incident.affectedComponentIds);
  for (const s of subs) {
    switch (s.kind) {
      case 'email':
        await enqueueEmail({
          to: s.email!,
          template: 'status-update',
          data: { incident, update, unsubscribeToken: s.unsubscribeToken },
        });
        break;
      case 'webhook':
        await dispatchWebhook({
          url: s.webhookUrl!,
          event: `status.${update.kind}`,
          payload: { incident, update },
        });
        break;
      case 'sms':
        if (s.phoneE164) await sendSms({ to: s.phoneE164, body: `Status: ${update.kind} — ${update.message.slice(0, 140)}` });
        break;
    }
  }
}
```

Fanout is **asynchronous**; the write path for publishing a status
update returns as soon as the snapshot is published, and
notification happens in a background queue. A slow SMS provider
doesn't stall the status update.

### 7. Atom / RSS + JSON feeds

```ts
// status-page-app/src/routes/feed.atom/+server.ts
export async function GET({ fetch }) {
  const { snapshot } = await loadSnapshot(fetch);
  const entries = [
    ...snapshot.incidents.active,
    ...snapshot.history.slice(0, 20),
  ]
    .flatMap((inc: PublicIncident) => inc.updates.map((u) => ({ inc, u })))
    .sort((a, b) => b.u.at.localeCompare(a.u.at))
    .slice(0, 50);

  const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Sveltesentio status updates</title>
  <link href="https://status.sveltesentio.com/"/>
  <id>tag:sveltesentio.com,2026:status</id>
  <updated>${new Date().toISOString()}</updated>
  ${entries.map(({ inc, u }) => `
  <entry>
    <id>tag:sveltesentio.com,2026:incident/${inc.id}/update/${u.id}</id>
    <title>${escapeXml(inc.title + ' — ' + u.kind)}</title>
    <updated>${u.at}</updated>
    <content type="text">${escapeXml(u.message)}</content>
    <link href="https://status.sveltesentio.com/incident/${inc.id}"/>
  </entry>`).join('')}
</feed>`;

  return new Response(atom, {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}
```

### 8. 90-day uptime calculation

```ts
// packages/status/src/uptime.ts
export async function computeUptime(componentId: string, days: number): Promise<{ days: Array<{ date: string; status: ComponentStatus; uptimePct: number }>; avgPct: number }> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);

  const events = await loadStatusEventsForComponent(componentId, start, end);
  const daily: Array<{ date: string; status: ComponentStatus; uptimePct: number }> = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400_000);
    const iso = d.toISOString().slice(0, 10);
    const dayEvents = events.filter((e) => e.at.slice(0, 10) === iso);
    const { worstStatus, uptimePct } = summarizeDay(dayEvents);
    daily.push({ date: iso, status: worstStatus, uptimePct });
  }

  const avgPct = daily.reduce((a, b) => a + b.uptimePct, 0) / days;
  return { days: daily, avgPct };
}
```

The uptime calculation is **contentious** with customers — decide the
definition up front: is "degraded_performance" counted as downtime?
Is maintenance excluded? Document it on the page itself.

## A11y invariants

- Banner uses `role="status"` + `aria-live="polite"` (not assertive —
  SR users don't need to be interrupted every 30s of polling).
- Status-color is supplementary; every status has text ("Major
  outage", not just red).
- Uptime-history grid has an accessible table fallback with dates +
  statuses.
- Each incident has `aria-labelledby` tying the article to its
  heading.
- Updates are in `<ol reversed>` for newest-first; `<time datetime>`
  attributes drive SR announcement.
- Subscribe form has real `<label>`, `autocomplete="email"`,
  `required`.

## Security invariants

- **Component names do not leak internals** — "Event Ingest", not
  "kafka-events-cluster-1".
- Subscribe endpoint is **rate-limited per IP** (30/hour).
- Subscribe response is **constant** regardless of email existence.
- Confirmation + unsubscribe tokens are cryptographically random.
- Unsubscribe link in email is **one-click** (RFC 8058 List-Unsubscribe).
- Snapshot `state.json` is world-readable (intentional); no PII.
- CDN cache-bust on publish prevents stale "all operational" during
  an ongoing incident.
- Status-page deployment does **not** share credentials with the main
  app — different IAM role, different DB user (or no DB at all).

## Testing

```ts
test('uptime calculation treats maintenance as excluded by default', async () => {
  const { avgPct } = await computeUptime(componentId, 30);
  expect(avgPct).toBeGreaterThan(99);
});
test('subscribe returns 202 for new and existing emails (no enumeration)', async () => {
  const r1 = await POST('/subscribe', { email: 'new@example.com' });
  const r2 = await POST('/subscribe', { email: 'existing@example.com' });
  expect(r1.status).toBe(202);
  expect(r2.status).toBe(202);
});
```

## Anti-patterns

1. **Status page hosted in the same infra** — black during outage.
2. **Reading from primary DB** — outage blackout. Read-replica or
   static snapshot.
3. **Component names that leak internal architecture** — "redis-
   queue-5" means nothing to customers and invites enumeration.
4. **Status = color only** — fails WCAG 1.4.1.
5. **Enumeration via subscribe response** — always 202.
6. **No double-opt-in** — spam vector; list gets blacklisted.
7. **Hardcoded "All systems operational" during an outage** — never.
   Always derive from component states.
8. **Including every third-party dep** when most users don't care —
   signal-to-noise suffers. List material deps only.
9. **Rendering at `/status` on the main domain** — defeats isolation.
10. **Long cache TTL (1 hour)** — announcement lag. 30s is the
    sweet spot.
11. **No feed / no webhooks** — tech-savvy customers want automation.
12. **Silent backdating** of timeline entries — loses trust.
13. **Showing individual engineer names** on updates — privacy + ops
    risk. Attribute to a team.
14. **Timeline entries editable** — audit + trust broken. Corrections
    as new entries citing previous id.
15. **Maintenance window as "outage"** — scheduled maintenance has
    its own visual treatment.
16. **No per-region component roll-up** — EU customers don't care
    about US incidents.
17. **Auto-resolved when alert clears** — operator confirms resolved,
    not a cron.
18. **Email sent before snapshot published** — subscribers click
    link; status page still says "operational".
19. **Mixing public + internal notes** in the same entry — privacy
    leak.
20. **"Currently no active incidents" when one is declared but not
    public-visible** — toggle cleanly.
21. **Status-page domain uses `__Host-*` session cookies** — there
    should be no auth on the public status page in the first place.
22. **Webhook subscription accepts `localhost` / RFC 1918 URLs** —
    SSRF vector.
23. **No rate-limit on feed endpoint** — cheap DoS.
24. **Exposing raw incident IDs that match internal ticket IDs** —
    fine, but don't make them meaningful (never put ticket IDs in
    customer-visible URLs).
25. **Not handling the "partial outage but overall operational" case
    visually** — users misread.

## References

- ADRs: [0019](../adr/0019-http-client-and-error-model.md),
  [0023](../adr/0023-compliance-audit-log-contract.md)
- Siblings:
  [incident-response.md](incident-response.md),
  [observability.md](observability.md),
  [multi-region-deployment.md](multi-region-deployment.md),
  [structured-emails.md](structured-emails.md),
  [webhooks-outbound.md](webhooks-outbound.md)
- Atlassian Statuspage reference: https://www.atlassian.com/software/statuspage
- RFC 8058: One-Click Email Unsubscribe
- Atom: RFC 4287
