# incident-response.md — composition recipe

> **Incident response surface for sveltesentio:** status page (cachet
> or instatus), on-call rotation contract, paging escalation matrix,
> incident timeline event-log, post-mortem template (blameless,
> RFC 9457-aligned), customer-comms templates, severity-classification
> rubric. Per [ADR-0023](../adr/0023-observability-uuidv7.md) +
> [ADR-0019](../adr/0019-server-state-discipline.md) every customer-
> visible degradation gets a public status entry **and** a structured
> internal timeline tied to the same UUIDv7 incident id, so engineering,
> support, and customers see one coherent narrative.

Treat this recipe as the **runbook contract**. The status page, the
pager, the comms templates, and the post-mortem all share one
`incident_id` — write it down once at declare-time and propagate it.

## Related

- [observability.md](observability.md) — UUIDv7 + RFC 9457 envelope; the
  incident id reuses the trace/correlation pattern
- [sentry-or-equivalent.md](sentry-or-equivalent.md) — error-tracker
  alerts that promote into incidents
- [opentelemetry-logs.md](opentelemetry-logs.md) — log query that
  produces the incident timeline
- [audit-log.md](audit-log.md) — sibling append-only log; incident
  timeline is operational, audit-log is user-action-facing
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  kill-switch + staged-rollback are the most common mitigation actions
- [data-migrations.md](data-migrations.md) — failed migration is the
  single most common Sev-1 trigger; cross-link the mitigation playbook
- [backup-recovery.md](backup-recovery.md) — RPO/RTO targets define when
  Sev-1 escalates to "restore from backup"
- [multi-region-deployment.md](multi-region-deployment.md) — manual
  failover is itself an incident-response procedure
- [error-boundaries.md](error-boundaries.md) — `+error.svelte`
  ProblemError envelope feeds Sentry → incident
- [rate-limiting.md](rate-limiting.md) — `429` flood is a Sev-3
  detection signal; declare if sustained > 5 min
- [ADR-0023](../adr/0023-observability-uuidv7.md) — UUIDv7 + correlation
  id contract
- [ADR-0019](../adr/0019-server-state-discipline.md) — RFC 9457 ProblemError
  envelope (incident-mode-banner reads from the same header)

## When to use what

```text
Single error → no incident                    → ticket only
Sustained error rate > SLO for 5 min          → declare Sev-3
Customer-visible feature down for one tenant  → declare Sev-2
Customer-visible feature down for all tenants → declare Sev-1
Data loss / security breach / GDPR-reportable → declare Sev-0
                                                + 72h DPA notification
Status page entry                             → every Sev-2 and above
Customer email                                → every Sev-1 and above
Post-mortem (blameless)                       → every Sev-2 and above
                                                published within 5 days
Incident timeline                             → every declaration
                                                regardless of severity
```

## Severity rubric (single source of truth)

```text
Sev-0  Data loss, security breach, GDPR Art.33 reportable
       Page CTO + DPO immediately. 72h regulator notification clock.
Sev-1  Service down for all tenants OR critical-path feature broken
       Page on-call primary. Status page within 15 min. Hourly updates.
Sev-2  Service degraded OR feature broken for one tenant / region
       Page on-call primary. Status page within 30 min. 4h updates.
Sev-3  SLO breach OR partial degradation < 50% of users
       Notify on-call (no page). Internal-only timeline. Optional status.
Sev-4  Cosmetic OR fixed-by-deploy in < 1h, no customer impact
       Track in ticket. No declaration.
```

## Install

```bash
# pager + status (managed; no SDK to install for status itself)
# Suggested vendors: PagerDuty / opsgenie for paging; cachet (self-host)
# or instatus (managed) for status pages. Both expose REST APIs we hit
# from the orchestrator endpoint below.

pnpm add -F @sveltesentio/incidents pino zod
# Pino because the structured logger is the timeline source of truth;
# Zod because every declare/update payload is a bounded API boundary.
```

> Per [ADR-0019](../adr/0019-server-state-discipline.md) we do **not**
> wrap PagerDuty/Opsgenie in a `@sveltesentio/*` adapter — the
> orchestrator hits their REST APIs directly with Zod-bound payloads.
> The pager vendor is replaceable per app.

## Shape — bounded Zod for every declaration

```ts
// packages/incidents/src/types.ts
import { z } from 'zod';

export const Severity = z.enum(['SEV0', 'SEV1', 'SEV2', 'SEV3', 'SEV4']);
export type Severity = z.infer<typeof Severity>;

export const IncidentStatus = z.enum([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);

export const Incident = z.object({
  id: z.string().uuid(), // UUIDv7 — see ADR-0023
  severity: Severity,
  title: z.string().min(8).max(120),
  summary: z.string().min(20).max(2000),
  status: IncidentStatus,
  declaredAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  declaredBy: z.string().uuid(),
  commander: z.string().uuid(),
  affectedServices: z.array(z.string().min(1).max(64)).min(1).max(20),
  affectedTenants: z.array(z.string().uuid()).max(10000).nullable(),
  // null = all tenants; capped to keep the JSON small.
  publicStatusPage: z.boolean(),
  customerCommsSent: z.boolean(),
  postMortemUrl: z.string().url().nullable(),
});
export type Incident = z.infer<typeof Incident>;

export const TimelineEntry = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  at: z.string().datetime(),
  actor: z.string().uuid(),
  kind: z.enum([
    'declared', 'severity-changed', 'commander-assigned',
    'status-changed', 'mitigation-applied', 'comms-sent',
    'note', 'resolved',
  ]),
  message: z.string().min(1).max(4000),
  // Free-text but bounded — no HTML, no markdown rendering on input.
  references: z
    .array(z.object({
      kind: z.enum(['log-query', 'trace', 'pr', 'runbook', 'dashboard']),
      url: z.string().url(),
    }))
    .max(20)
    .optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const DeclareInput = Incident.pick({
  severity: true,
  title: true,
  summary: true,
  affectedServices: true,
  affectedTenants: true,
}).extend({
  publicStatusPage: z.boolean().default(true),
});
```

The `Incident` schema is the **only** way an incident enters the system.
Pager webhooks, manual `/incidents/declare` UI, and CLI all funnel
through `DeclareInput` → `safeParse` → `recordIncident()`.

## Reference pattern

### Declaration endpoint (orchestrator)

```ts
// src/routes/api/incidents/declare/+server.ts
import { json } from '@sveltejs/kit';
import { v7 as uuidv7 } from 'uuid';
import { DeclareInput } from '@sveltesentio/incidents';
import { recordIncident, paginCommander, postStatusPage } from '$lib/server/incidents';
import { requirePermission } from '$lib/server/auth';

export async function POST({ request, locals }) {
  await requirePermission(locals.user, 'incidents.declare');
  const parsed = DeclareInput.safeParse(await request.json());
  if (!parsed.success) {
    return json({ type: 'about:blank', title: 'Invalid declaration', status: 422, errors: parsed.error.issues }, { status: 422 });
  }

  const id = uuidv7();
  const declaredAt = new Date().toISOString();
  const commander = await paginCommander(parsed.data.severity);

  const incident = await recordIncident({
    id,
    declaredAt,
    declaredBy: locals.user.id,
    commander: commander.userId,
    status: 'investigating',
    resolvedAt: null,
    customerCommsSent: false,
    postMortemUrl: null,
    ...parsed.data,
  });

  if (parsed.data.publicStatusPage && parsed.data.severity !== 'SEV3' && parsed.data.severity !== 'SEV4') {
    await postStatusPage(incident); // status-page vendor REST call
  }

  return json(incident, { status: 201 });
}
```

Notes on this contract:

- **UUIDv7** (`uuidv7()`) gives time-ordered ids that double as
  cursor pagination keys — see [observability.md](observability.md).
- **`requirePermission('incidents.declare')`** — only on-call + SREs
  can declare. Avoids declarations by accident.
- **Pager call returns a real human** (`commander.userId`), not a
  team alias. The commander is accountable.
- **Status page is fired *before* mitigation begins** — communicate
  early; you can always update with `monitoring` → `resolved`.

### Pager + commander assignment

```ts
// src/lib/server/incidents/pager.ts
import { z } from 'zod';
import { env } from '$env/dynamic/private';

const PagerResponse = z.object({
  incidentKey: z.string().min(1),
  acknowledgedBy: z.object({ userId: z.string().uuid(), name: z.string() }),
});

export async function paginCommander(severity: string) {
  const res = await fetch('https://api.pagerduty.com/incidents', {
    method: 'POST',
    headers: {
      Authorization: `Token token=${env.PAGERDUTY_TOKEN}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      From: env.PAGERDUTY_FROM_EMAIL,
    },
    body: JSON.stringify({
      incident: {
        type: 'incident',
        title: `[${severity}] sveltesentio incident`,
        service: { id: env.PAGERDUTY_SERVICE_ID, type: 'service_reference' },
        urgency: severity === 'SEV0' || severity === 'SEV1' ? 'high' : 'low',
      },
    }),
  });
  if (!res.ok) {
    // Pager outage during incident is itself an incident — fall back to
    // SMS via Twilio with the same recipient list, do NOT silently drop.
    await fallbackSms(severity);
    throw new Error(`Pager unavailable: ${res.status}`);
  }
  const json = await res.json();
  return PagerResponse.parse(json.incident);
}
```

### Timeline append

```ts
// src/lib/server/incidents/timeline.ts
import { v7 as uuidv7 } from 'uuid';
import { TimelineEntry } from '@sveltesentio/incidents';
import { db } from '$lib/server/db';

export async function appendTimeline(input: Omit<TimelineEntry, 'id' | 'at'>) {
  const entry = TimelineEntry.parse({
    ...input,
    id: uuidv7(),
    at: new Date().toISOString(),
  });
  // Append-only — no UPDATE, no DELETE. The integrity is the point.
  await db.query(
    `INSERT INTO incident_timeline
       (id, incident_id, at, actor, kind, message, references)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.id, entry.incidentId, entry.at, entry.actor, entry.kind, entry.message, JSON.stringify(entry.references ?? [])],
  );
  return entry;
}
```

### Post-mortem template (blameless)

`docs/post-mortems/<incident-id>.md` — rendered by the comms tool from
this template:

```markdown
# Post-mortem — <incident.title>

- **Incident id:** <incident.id> (UUIDv7)
- **Severity:** <SEV0..SEV4>
- **Declared:** <declaredAt> by <declaredBy>
- **Commander:** <commander>
- **Resolved:** <resolvedAt> (duration: <Δ>)
- **Customer impact:** <users affected, regions affected, features
  unavailable, data lost (yes/no), GDPR-reportable (yes/no)>

## Summary
One paragraph for the executive reader. No engineering jargon.

## Timeline
Verbatim copy of `incident_timeline` for this id. Times in UTC.

## Root cause
What chain of events made the failure possible. Name systems, not
people. "The deploy pipeline applied a migration with a missing
index" — not "Alice forgot the index".

## Detection
How did we find out? Who/what alerted? Was the alert timely?
If detection was slow, this is its own action item.

## Response
Decisions made, mitigations attempted, what worked and what did not.

## Recovery
Final mitigation. Time-to-resolve. Verification steps that confirmed
recovery.

## What went well
At least three things. Always.

## What did not go well
At least three things. Always.

## Action items
| ID | Owner | Description | Due | Status |
|---|---|---|---|---|
| AI-001 | <name> | <action> | <date> | open |

Action items become Linear/Jira tickets within 24h. Track to
completion in a recurring monthly post-mortem review.
```

### Customer-comms templates

`src/lib/server/incidents/comms/`:

```ts
// initial-notification.ts
export const initialNotification = ({ severity, title, services }: {
  severity: string; title: string; services: string[];
}) => ({
  subject: `[Status] We're investigating an issue with ${services.join(', ')}`,
  body: `Hi,\n\nWe're currently investigating an issue affecting ${services.join(', ')}. Some users may experience ${title.toLowerCase()}.\n\nFollow live updates: https://status.example.com\nWe'll send another update within 60 minutes (or sooner if resolved).\n\n— sveltesentio operations`,
});

// resolution-notification.ts
export const resolutionNotification = ({ id, services, durationMinutes, postMortemUrl }: {
  id: string; services: string[]; durationMinutes: number; postMortemUrl: string | null;
}) => ({
  subject: `[Resolved] Issue with ${services.join(', ')} is fixed`,
  body: `The incident affecting ${services.join(', ')} is resolved (duration: ${durationMinutes} min).\n\nWe'll publish a post-mortem within 5 business days${postMortemUrl ? ` here: ${postMortemUrl}` : ''}.\n\nIncident id: ${id}\n\n— sveltesentio operations`,
});
```

Comms rules:

- **Plain text, no marketing copy.** "We're sorry for any
  inconvenience" is fine; "We value your trust" is not.
- **Always attach the incident id.** Customers cite it in support tickets;
  support correlates without asking.
- **Never blame a vendor in initial comms.** "Our authentication
  provider is degraded" is fine after resolution; before, just say
  "users may have trouble signing in".

### Status-page driver

```ts
// src/lib/server/incidents/status-page.ts
import { env } from '$env/dynamic/private';

export async function postStatusPage(incident: { id: string; title: string; summary: string; affectedServices: string[]; status: string }) {
  // Cachet API shape; instatus is similar — keep this small and replaceable.
  const res = await fetch(`${env.CACHET_BASE_URL}/api/v1/incidents`, {
    method: 'POST',
    headers: {
      'X-Cachet-Token': env.CACHET_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: incident.title,
      message: incident.summary,
      status: 1, // 1=investigating, 2=identified, 3=watching, 4=fixed
      visible: 1,
      stickied: false,
      notify: true,
      component_ids: incident.affectedServices,
      template_vars: { incident_id: incident.id },
    }),
  });
  if (!res.ok) {
    // Status page failure is its own Sev-2 — page secondary on-call.
    throw new Error(`Status page failed: ${res.status}`);
  }
}
```

### Incident-mode UI banner

```svelte
<!-- src/lib/components/IncidentBanner.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { z } from 'zod';

  const ActiveIncident = z.object({
    id: z.string().uuid(),
    severity: z.enum(['SEV0', 'SEV1', 'SEV2', 'SEV3', 'SEV4']),
    title: z.string(),
    statusUrl: z.string().url(),
  }).nullable();

  let active = $state<z.infer<typeof ActiveIncident>>(null);

  onMount(async () => {
    const res = await fetch('/api/incidents/active', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const parsed = ActiveIncident.safeParse(await res.json());
    if (parsed.success) active = parsed.data;
  });
</script>

{#if active && (active.severity === 'SEV0' || active.severity === 'SEV1' || active.severity === 'SEV2')}
  <div role="status" aria-live="polite" class="bg-amber-100 dark:bg-amber-900 text-amber-950 dark:text-amber-50 px-4 py-2 text-sm">
    <span class="font-medium">Service incident:</span> {active.title}.
    <a href={active.statusUrl} class="underline">Live status</a>
  </div>
{/if}
```

The banner uses `role="status"` not `role="alert"` — `alert` interrupts
the SR user mid-task, which is hostile if they're working through the
incident. `polite` is announced at the next SR pause.

### Escalation matrix (declare-once data)

```ts
// src/lib/server/incidents/escalation.ts
export const ESCALATION = {
  SEV0: ['oncall-primary', 'oncall-secondary', 'cto', 'dpo'],
  SEV1: ['oncall-primary', 'oncall-secondary', 'engineering-manager'],
  SEV2: ['oncall-primary', 'engineering-manager'],
  SEV3: ['oncall-primary'],
  SEV4: [],
} as const;

export const COMMS_AUTHORITY = {
  SEV0: 'cto',           // CTO signs off on all customer comms
  SEV1: 'engineering-manager',
  SEV2: 'oncall-primary',
  SEV3: 'oncall-primary',
  SEV4: null,
} as const;
```

This table lives in code (not in a wiki) so it ships with the codebase
and changes via PR review — no out-of-band wiki edits during an actual
incident.

## Auto-detection → declaration funnel

Three signals graduate to a declaration:

1. **SLO burn-rate alarm** (Prometheus / Grafana) — fires after 5 min
   of sustained error rate above SLO budget. Webhooks
   `/api/incidents/auto-declare` with severity computed from burn-rate.
2. **Sentry alert** — error rate × 10 over baseline → Sev-3
   auto-declare. See [sentry-or-equivalent.md](sentry-or-equivalent.md).
3. **Health-check failure across regions** — `multi-region` regional
   health checks (see [multi-region-deployment.md](multi-region-deployment.md))
   for > 60s in two regions = Sev-1 auto-declare.

Auto-declares fire the same `recordIncident()` path as manual ones —
they are *not* a separate code path. The commander is paged
immediately and can downgrade or close as needed.

## Practice: GameDay drills

- **Quarterly cadence.** Pick one of: pager outage, status page outage,
  primary database failover, regional outage. Run the playbook for real.
- **Rotate commanders.** Every engineer who can be paged must lead at
  least one drill per year. This is how the rubric stays familiar.
- **Always write a post-mortem for the drill** — drills produce just
  as many process improvements as real incidents.

## Anti-patterns

- **Declaring an incident only after a customer complains.** SLO alarms
  exist precisely so the team knows before the customer does.
- **Letting Sev-3 incidents accumulate without a public status entry
  pattern.** A spike of internal-only Sev-3s often signals a Sev-1
  brewing — track them anyway.
- **Naming a person as "responsible" in the post-mortem.** Blameless
  means *systems* fail, not people. Replace "Alice forgot to update
  the index" with "the deploy pipeline did not enforce migration
  validation".
- **Letting the commander also be the engineer fixing the issue.** The
  commander coordinates; a separate IC fixes. Splitting the role
  prevents tunnel-vision.
- **Editing past timeline entries.** The timeline is append-only.
  Corrections come as new entries citing the previous entry id.
- **Customer comms with marketing copy.** "We value your trust during
  this challenging time" makes things worse. Stick to facts.
- **Bare-URL status page links in emails.** Always include the human
  page name and the incident id; bare URLs route through suspicion
  filters.
- **Status updates more frequent than 30 min for Sev-2 with nothing
  new to report.** "Still investigating" five times in a row reads as
  panic. Set the next-update-by time and stick to it.
- **Pager set to email-only.** Email is best-effort; a Sev-1 needs SMS
  or push that bypasses Do-Not-Disturb. Configure the pager properly.
- **Storing pager API tokens in client bundles.** The status driver and
  pager driver are server-only — see [secrets-management.md](secrets-management.md).
- **Status page driven from the same database that's down.** Use a
  third-party (instatus) or an isolated cachet pod with its own DB.
  Self-hosting on the same RDS as the app guarantees a dark status
  page during a Sev-1.
- **Post-mortem without action items.** If there are zero action items
  the post-mortem is incomplete — at minimum "improve detection",
  "improve communication", or "improve runbook" applies.
- **Action items without owners + due dates.** "Someone should look
  into this" never gets done. Owner, due date, status — non-optional.
- **Letting action items linger past 90 days.** Quarterly review:
  triage every open AI; either complete, downgrade to backlog, or
  cancel with rationale.
- **Skipping the post-mortem because the incident was "small".** Sev-2
  and above always get one — even if the post-mortem is half a page.
  The discipline is what matters.
- **No on-call handover ritual.** Outgoing on-call must brief incoming
  on open issues, in-flight mitigations, and known-fragile systems.
- **Single on-call (no secondary).** If primary is unreachable the
  incident response stalls. Always page primary + secondary.
- **No GDPR/regulator notification clock.** Sev-0 starts a 72h
  notification clock per Art. 33 — see
  [audit-log.md](audit-log.md) and the DPA. Track it on the timeline.
- **Auto-resolving incidents based on alarm clearing.** Alarms can
  clear because the metric collector died, not because the system
  recovered. A human marks `resolved`.
- **Customer comms subject line mentioning the company name first.**
  "[Status] X is investigating an issue" is what filters expect;
  "X — Important update about your service" reads as marketing and
  gets buried.
- **Using `role="alert"` for the incident banner.** Steals SR focus
  from whatever the user was doing. Use `role="status"`.
- **Using yellow/amber for Sev-1 banner.** Color-only signaling fails
  WCAG 1.4.1; pair color with the explicit "Service incident:" prefix.
- **Linking the post-mortem behind SSO-only resources.** Customers
  cannot read it. Publish a sanitized version on the public blog or
  the status page.
- **Leaving the status page in `investigating` state after recovery.**
  Always close to `resolved` with a final timestamped message; an
  abandoned `investigating` entry erodes trust on the next incident.

## References

- ADRs: [0019](../adr/0019-server-state-discipline.md),
  [0023](../adr/0023-observability-uuidv7.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md) (regulator
  notification touch-points)
- Sibling recipes: [observability.md](observability.md),
  [sentry-or-equivalent.md](sentry-or-equivalent.md),
  [opentelemetry-logs.md](opentelemetry-logs.md),
  [audit-log.md](audit-log.md),
  [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md),
  [data-migrations.md](data-migrations.md),
  [backup-recovery.md](backup-recovery.md),
  [multi-region-deployment.md](multi-region-deployment.md),
  [error-boundaries.md](error-boundaries.md),
  [rate-limiting.md](rate-limiting.md)
- External: Google SRE Workbook ch. "Incident Response" + "Postmortem
  Culture"; PagerDuty incident-response docs (incident-commander
  pattern); Atlassian incident handbook; ICO breach notification
  guidance (UK GDPR Art. 33); status-page UX research from instatus +
  cachet community
