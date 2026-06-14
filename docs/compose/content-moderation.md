# `content-moderation.md` — trust-and-safety moderation recipe for sveltesentio

User-generated content (text posts, images, profile bios, support
tickets, reviews) requires a moderation pipeline that combines
**automated pre-screening** (LLM/classifier triage) + **human review
queue** (final decisions on ambiguous cases) + **policy engine**
(deterministic rule application) + **audit trail** (every decision
recorded for legal + appeals) + **transparency report** (DSA Art.24
disclosures), per [ADR-0023](../adr/0023-compliance-observability.md)
+ [ADR-0045](../adr/0045-ai-compliance.md).

EU **DSA** (Digital Services Act, in force 2024) mandates response
times, appeals, transparency reports, and notice-and-action flows
for any platform with >50 employees or >10M EU users. UK Online
Safety Act 2023 has parallel obligations. This recipe assumes
non-trivial scale; for tiny platforms (<10K users) a simple
"report → email admin" loop is sufficient.

## Related

- [audit-log.md](audit-log.md) — every moderation decision logs
- [ai-vercel-sdk.md](ai-vercel-sdk.md) — LLM provider for triage
- [ai-audit-hook.md](ai-audit-hook.md) — EU AI Act compliance event
  hook (mandatory for AI-assisted decisions affecting users)
- [admin-ui-patterns.md](admin-ui-patterns.md) — moderator queue
  table + bulk actions + impersonation discipline
- [rbac-modeling.md](rbac-modeling.md) — moderator/admin/appeals
  reviewer roles + scope-bounded permissions
- [notifications-center.md](notifications-center.md) — user
  notifications on action taken / appeal outcome
- [account-deletion.md](account-deletion.md) — terminal action of
  policy violation cascade
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  staged rollout of new policy rules (high-risk by definition)
- [ADR-0023](../adr/0023-compliance-observability.md)
- [ADR-0045](../adr/0045-ai-compliance.md)
- DSA Art. 14, 16, 17, 20, 24:
  `eur-lex.europa.eu/eli/reg/2022/2065/oj`

## When to use what — decision tree

```text
No UGC at all                              → skip this recipe
UGC, <10K MAU, low-risk content            → email-to-admin reports
UGC, >10K MAU, public surfaces             → this recipe (full pipeline)
EU users + >50 employees OR >10M EU MAU    → this recipe + DSA report endpoint mandatory
Live-chat / DMs                            → this recipe + real-time intervention path
Image / video moderation                   → this recipe + image classifier (Hive, Sightengine)
CSAM detection                             → this recipe + NCMEC PhotoDNA / hash-matching (mandatory legal reporting)
```

**CSAM detection is non-negotiable.** Any platform allowing user
image uploads must run hash-matching against NCMEC databases and
report matches to NCMEC CyberTipline (US) or equivalent. This
recipe touches the integration but the legal pipeline is out of
scope here — engage counsel.

## Architecture — the four-stage pipeline

```text
1. INGEST              2. TRIAGE                3. REVIEW              4. ACT
                                                                       
user posts content     classifier + LLM         human review queue     decision applied:
   │                   evaluates against        moderator inspects     - allow
   │ enqueue           policy rules             content + context      - hide (soft)
   ▼                   confidence < threshold   makes decision         - remove (hard)
moderation_queue       → human review           ▼                      - warn user
   │                   confidence ≥ threshold   review_decision        - suspend
   │                   → auto-action            (justification +       - escalate
   │                   ▼                        policy citation)       ▼
   │                   auto_decision            ▼                      audit_log + notify
   │                   ▼                        moderation_action      user + appeals
   │                   audit_log
   ▼
   appeals path → re-review queue → reverse / uphold
```

Auto-action threshold defaults: **confidence ≥ 0.95 + low-impact
violation type** (spam, malformed) → auto-act. Anything else queues
for human review. **Never auto-suspend or auto-delete accounts** —
those decisions always go through human review.

## Shape — bounded Zod contracts

```ts
// packages/moderation/src/schema.ts
import { z } from 'zod';

export const ContentSurface = z.enum([
  'post',
  'comment',
  'profile_bio',
  'message',
  'review',
  'image',
  'video',
]);
export type ContentSurface = z.infer<typeof ContentSurface>;

export const PolicyRule = z.enum([
  'spam',
  'hate_speech',
  'harassment',
  'self_harm',
  'sexual_content',
  'csam', // child sexual abuse material — mandatory escalation
  'violence',
  'misinformation',
  'illegal_goods',
  'impersonation',
  'malware_phishing',
  'copyright',
  'pii_exposure',
  'other',
]);
export type PolicyRule = z.infer<typeof PolicyRule>;

export const ModerationAction = z.enum([
  'allow',
  'hide',           // soft: not visible to others, visible to author
  'remove',         // hard: deleted (with grace period for restore)
  'warn',           // user gets policy reminder
  'suspend',        // account suspended, optional duration
  'ban',            // permanent
  'escalate',       // route to senior reviewer / legal
]);
export type ModerationAction = z.infer<typeof ModerationAction>;

export const TriageVerdict = z.object({
  contentId: z.string().uuid(),
  surface: ContentSurface,
  rules: z.array(z.object({
    rule: PolicyRule,
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(2000),
  })).min(0).max(20),
  // Routing decision: which threshold tier this hit
  routing: z.enum(['auto_action', 'human_review', 'allow_clear']),
  // Always log the model + version that produced this verdict
  classifier: z.string().min(1).max(100),
  classifierVersion: z.string().min(1).max(50),
  triageDurationMs: z.number().int().nonnegative(),
});
export type TriageVerdict = z.infer<typeof TriageVerdict>;

export const ReviewDecision = z.object({
  contentId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  action: ModerationAction,
  ruleApplied: PolicyRule,
  // Justification mandatory; appears on appeal / DSA notice
  justification: z.string().min(20).max(2000),
  // Was AI triage shown to reviewer? (DSA transparency)
  aiAssisted: z.boolean(),
  decidedAt: z.string().datetime(),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const Appeal = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  appellantUserId: z.string().uuid(),
  // DSA: appellant must give reasons; we constrain length
  reason: z.string().min(20).max(2000),
  status: z.enum(['pending', 'upheld', 'reversed']),
  filedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolverId: z.string().uuid().nullable(),
  resolverJustification: z.string().max(2000).nullable(),
});
export type Appeal = z.infer<typeof Appeal>;
```

Bounded enums for `PolicyRule` + `ModerationAction` mean every
decision is parseable + filterable + reportable. New rule types =
new enum value + `feature-flag-rollout-patterns.md` rollout (because
new rules are high-risk policy changes).

## Reference — triage worker

```ts
// packages/moderation/src/triage.ts
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { TriageVerdict, PolicyRule, type ContentSurface } from './schema';
import { recordAiAuditEvent } from '@sveltesentio/ai/audit';
import { db } from '$lib/server/db';

const TriageSchema = z.object({
  rules: z.array(z.object({
    rule: PolicyRule,
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(2000),
  })),
});

export async function triage(input: {
  contentId: string;
  surface: ContentSurface;
  text: string;
  userId: string;
}): Promise<TriageVerdict> {
  const t0 = performance.now();

  // CSAM detection runs FIRST and short-circuits everything else.
  // This is hash-matching against NCMEC PhotoDNA, NOT LLM-based.
  // Out of scope here; assume external service.

  const result = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: TriageSchema,
    system: SYSTEM_PROMPT,
    prompt: `Content: ${input.text}\n\nSurface: ${input.surface}`,
  });

  // High-confidence CSAM signal → escalate immediately, never auto-action.
  const hasCsam = result.object.rules.some((r) => r.rule === 'csam' && r.confidence > 0.5);

  // Bounded auto-action: only spam + malformed at very high confidence.
  const topRule = result.object.rules.sort((a, b) => b.confidence - a.confidence)[0];
  const autoActionable: PolicyRule[] = ['spam'];
  const routing: TriageVerdict['routing'] =
    hasCsam ? 'human_review'
    : topRule && topRule.confidence >= 0.95 && autoActionable.includes(topRule.rule) ? 'auto_action'
    : topRule && topRule.confidence < 0.3 ? 'allow_clear'
    : 'human_review';

  const verdict = TriageVerdict.parse({
    contentId: input.contentId,
    surface: input.surface,
    rules: result.object.rules,
    routing,
    classifier: 'openai:gpt-4o-mini',
    classifierVersion: '2026-04',
    triageDurationMs: Math.round(performance.now() - t0),
  });

  // EU AI Act compliance hook: every AI-derived decision affecting users.
  await recordAiAuditEvent({
    type: 'content_moderation_triage',
    subject: input.userId,
    decision: verdict.routing,
    model: verdict.classifier,
    inputs: { surface: input.surface, contentId: input.contentId },
    outputs: { rules: verdict.rules.map((r) => ({ rule: r.rule, confidence: r.confidence })) },
  });

  // Persist verdict for review-queue context.
  await db.query(
    `INSERT INTO triage_verdicts (content_id, verdict, classifier, classifier_version)
     VALUES ($1, $2, $3, $4)`,
    [verdict.contentId, JSON.stringify(verdict), verdict.classifier, verdict.classifierVersion],
  );

  return verdict;
}

const SYSTEM_PROMPT = `You are a content moderation triage assistant.
Evaluate the content against these policy rules: spam, hate_speech, harassment,
self_harm, sexual_content, csam, violence, misinformation, illegal_goods,
impersonation, malware_phishing, copyright, pii_exposure.

For each rule that applies, output: rule name, confidence 0..1, brief rationale.
Be conservative. If unsure, lower confidence. NEVER recommend an action — your
job is signal extraction only. Human reviewers make decisions.`;
```

LLM extracts **signals**, never makes **decisions**. The routing
logic is pure code with bounded thresholds — auditable + testable +
diff-able when policy shifts.

## Reference — moderator review queue

```ts
// src/routes/admin/moderation/+page.server.ts
import { ReviewDecision } from '@sveltesentio/moderation/schema';
import { permissions } from '$lib/server/permissions';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/audit';
import { applyAction } from '@sveltesentio/moderation/act';
import type { PageServerLoad, Actions } from './$types';
import { superValidate, fail } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';

export const load: PageServerLoad = async ({ locals }) => {
  permissions(locals.user).require('moderation.review');

  const queue = await db.query(
    `SELECT q.id, q.content_id, q.surface, q.priority, q.created_at,
            t.verdict AS triage_verdict, c.text AS content_text, c.user_id AS author_id
     FROM moderation_queue q
     JOIN triage_verdicts t ON t.content_id = q.content_id
     JOIN contents c ON c.id = q.content_id
     WHERE q.status = 'pending'
       AND (q.locked_by IS NULL OR q.locked_at < NOW() - INTERVAL '5 minutes')
     ORDER BY q.priority DESC, q.created_at ASC
     LIMIT 50`,
  );

  return { queue: queue.rows };
};

export const actions: Actions = {
  decide: async ({ request, locals }) => {
    permissions(locals.user).require('moderation.review');

    const form = await superValidate(request, zod(ReviewDecision.omit({ reviewerId: true, decidedAt: true })));
    if (!form.valid) return fail(400, { form });

    const decision = ReviewDecision.parse({
      ...form.data,
      reviewerId: locals.user.id,
      decidedAt: new Date().toISOString(),
    });

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO review_decisions (content_id, reviewer_id, action, rule_applied, justification, ai_assisted, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [decision.contentId, decision.reviewerId, decision.action, decision.ruleApplied,
         decision.justification, decision.aiAssisted, decision.decidedAt],
      );
      await tx.query(
        `UPDATE moderation_queue SET status = 'resolved', locked_by = NULL WHERE content_id = $1`,
        [decision.contentId],
      );
    });

    await applyAction(decision);
    await auditLog('moderation.decision', { ...decision, surface: 'admin_ui' });
  },
};
```

Queue items are **soft-locked** for 5 minutes when a moderator opens
them — prevents two moderators reviewing the same item; lock auto-
expires if reviewer walks away.

## Reference — apply action with user notification

```ts
// packages/moderation/src/act.ts
import type { ReviewDecision } from './schema';
import { db } from '$lib/server/db';
import { sendNotification } from '@sveltesentio/notifications';
import { auditLog } from '$lib/server/audit';

export async function applyAction(d: ReviewDecision) {
  const content = await db.queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM contents WHERE id = $1`, [d.contentId],
  );

  switch (d.action) {
    case 'allow':
      // No state change; record decision only (used for false-positive feedback to triage).
      break;

    case 'hide':
      await db.query(`UPDATE contents SET visibility = 'hidden_by_moderation' WHERE id = $1`, [d.contentId]);
      break;

    case 'remove':
      // Soft-delete first; hard-delete after grace per account-deletion.md cadence.
      await db.query(`UPDATE contents SET deleted_at = NOW(), removed_reason = $1 WHERE id = $2`,
        [d.ruleApplied, d.contentId]);
      break;

    case 'warn':
      // No content state change; user gets a policy reminder.
      break;

    case 'suspend':
      await db.query(`UPDATE users SET status = 'suspended', suspended_until = NOW() + INTERVAL '7 days' WHERE id = $1`,
        [content.user_id]);
      break;

    case 'ban':
      await db.query(`UPDATE users SET status = 'banned' WHERE id = $1`, [content.user_id]);
      break;

    case 'escalate':
      await db.query(`UPDATE moderation_queue SET priority = 'high', escalated_at = NOW(), status = 'pending' WHERE content_id = $1`,
        [d.contentId]);
      return; // no user-facing notice; senior reviewer takes it
  }

  // DSA Art.17: user notified of action with reasons + appeals path.
  if (d.action !== 'allow') {
    await sendNotification({
      userId: content.user_id,
      type: 'moderation.action_taken',
      dedupeKey: `mod-action:${d.contentId}:${d.action}`,
      meta: {
        action: d.action,
        ruleApplied: d.ruleApplied,
        justification: d.justification,
        appealUrl: `/appeals/new?content=${d.contentId}`,
      },
    });
  }
}
```

Every non-`allow` action triggers a **DSA-compliant statement of
reasons** to the user with a clear appeals path.

## Appeals — DSA Art.20 internal complaint mechanism

```ts
// src/routes/appeals/[id]/+page.server.ts (resolver UI)
import { Appeal } from '@sveltesentio/moderation/schema';
import { db } from '$lib/server/db';
import { permissions } from '$lib/server/permissions';
import { sendNotification } from '@sveltesentio/notifications';
import { auditLog } from '$lib/server/audit';

export const actions = {
  resolve: async ({ request, locals, params }) => {
    permissions(locals.user).require('moderation.appeal_review');

    const data = await request.formData();
    const status = z.enum(['upheld', 'reversed']).parse(data.get('status'));
    const justification = z.string().min(20).max(2000).parse(data.get('justification'));

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE appeals SET status = $1, resolved_at = NOW(), resolver_id = $2, resolver_justification = $3
         WHERE id = $4`,
        [status, locals.user.id, justification, params.id],
      );

      if (status === 'reversed') {
        const appeal = await tx.queryOne<{ content_id: string }>(
          `SELECT content_id FROM appeals WHERE id = $1`, [params.id],
        );
        // Restore content
        await tx.query(`UPDATE contents SET visibility = 'public', deleted_at = NULL WHERE id = $1`,
          [appeal.content_id]);
      }
    });

    await sendNotification({
      userId: appeal.appellantUserId,
      type: 'moderation.appeal_resolved',
      dedupeKey: `appeal-resolve:${params.id}`,
      meta: { status, justification },
    });

    await auditLog('moderation.appeal_resolved', { appealId: params.id, status, resolverId: locals.user.id });
  },
};
```

DSA Art.20 requires **human review** of appeals (no auto-decisions),
**timely processing** (we target 7 days), **free of charge**, and
**reasoned outcomes**. Appeal resolutions feed back into triage as
training-feedback (per [ai-audit-hook.md](ai-audit-hook.md)) so the
classifier improves.

## DSA transparency report — Art.24

```ts
// packages/moderation/src/transparency.ts
// Generate yearly report aggregating all moderation activity.
export async function buildTransparencyReport(periodStart: Date, periodEnd: Date) {
  return {
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    actions: await db.query(
      `SELECT action, rule_applied, COUNT(*) AS count
       FROM review_decisions
       WHERE decided_at >= $1 AND decided_at < $2
       GROUP BY action, rule_applied`,
      [periodStart, periodEnd],
    ),
    appeals: await db.query(
      `SELECT status, COUNT(*) AS count FROM appeals
       WHERE filed_at >= $1 AND filed_at < $2
       GROUP BY status`,
      [periodStart, periodEnd],
    ),
    automatedShare: await db.queryOne(
      `SELECT
         AVG(CASE WHEN ai_assisted THEN 1 ELSE 0 END) AS ai_share,
         COUNT(*) FILTER (WHERE ai_assisted) AS ai_count,
         COUNT(*) AS total
       FROM review_decisions
       WHERE decided_at >= $1 AND decided_at < $2`,
      [periodStart, periodEnd],
    ),
    medianResponseTimeMs: await db.queryOne(
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (decided_at - created_at)) * 1000) AS median
       FROM review_decisions r JOIN moderation_queue q ON q.content_id = r.content_id
       WHERE r.decided_at >= $1 AND r.decided_at < $2`,
      [periodStart, periodEnd],
    ),
  };
}
```

Published yearly per DSA Art.24. The endpoint `/transparency/{year}`
serves the JSON + a human-readable summary page.

## Anti-patterns (25)

1. **Auto-suspending or auto-banning accounts via classifier** —
   high false-positive rate; permanent reputation damage.
   **Always** human review for terminal actions.
2. **No appeal path** — DSA Art.20 violation. Mandatory in EU.
3. **Appeal handled by the same moderator who made the original
   decision** — no oversight; same biases. Always different
   reviewer.
4. **Justification field optional / free-form** — moderators write
   "violates ToS" with no detail; DSA notice fails compliance. Min
   length + reference to specific rule.
5. **No CSAM hash-matching** — legal violation. Mandatory in US/EU.
6. **LLM verdict treated as the decision** — every reviewer must see
   the content + verdict + ability to disagree.
7. **No audit log on triage** — EU AI Act Art.13 + DSA Art.15
   require traceability of automated decisions.
8. **Queue items not soft-locked** — two moderators review same
   item; conflicting decisions; race condition.
9. **Lock without expiry** — moderator closes browser; item stays
   locked forever. 5-min auto-expire.
10. **No moderator action history** — can't detect biased reviewers
    or spot training opportunities.
11. **Notification to user has no specific rule cited** — DSA notice
    of action requires specific reasons.
12. **Permanent auto-actions without grace** — restorability matters
    for false positives. Soft-delete with 30d grace before hard.
13. **Public ban list / content shaming** — privacy + GDPR violation
    (data minimization). Decisions are private.
14. **Moderator queue UI shows author's other content / IP /
    payment info by default** — fishing-expedition risk; least-
    privilege view by default, expand on justification per
    [admin-ui-patterns.md](admin-ui-patterns.md) impersonation
    discipline.
15. **No false-positive feedback loop** — `allow` decisions
    on `human_review` queue items don't feed back to retrain the
    classifier; quality stagnates.
16. **Triage classifier without versioning** — model upgrade
    silently changes verdicts; can't reproduce past decisions.
    Pin model version + log on every triage.
17. **Real-time chat moderation done in-band** — adds latency to
    every message. Out-of-band classifier with quarantine + delete-
    after-the-fact.
18. **No per-rule rollout** — adding `misinformation` rule globally
    on day 1 → moderator queue floods. Stage rollout per
    [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md).
19. **Reviewer permissions overly broad** — `moderation.*` scope
    grants append + delete + appeal-review + transparency-export.
    Split per [rbac-modeling.md](rbac-modeling.md).
20. **No oncall path for emergencies** — coordinated harassment
    campaign / mass-CSAM-upload requires emergency response. 24/7
    rotation for high-severity rules.
21. **Triage verdict not shown to reviewer** — they re-read from
    scratch; slow + inconsistent. Always show + flag biases ("AI
    flagged hate_speech 0.87 — reviewer disagreed 4 of last 10
    times").
22. **Storing original content forever after removal** — GDPR
    minimization; legitimate-interest balance test for retention.
    Default 1y for evidence, then purge.
23. **No transparency report at all** — DSA Art.24 violation for
    qualifying platforms.
24. **Auto-removing all content from a banned user retroactively** —
    sweeping action; should be opt-in per case + audit-logged each.
25. **No moderator wellbeing program** — exposure to violent /
    abusive content causes vicarious trauma. Rotate moderators off
    high-severity queues, provide counseling, cap exposure hours.

## References

- ADRs: [0023](../adr/0023-compliance-observability.md),
  [0045](../adr/0045-ai-compliance.md),
  [0035](../adr/0035-permissions-model.md)
- Sibling recipes:
  [audit-log.md](audit-log.md),
  [ai-vercel-sdk.md](ai-vercel-sdk.md),
  [ai-audit-hook.md](ai-audit-hook.md),
  [admin-ui-patterns.md](admin-ui-patterns.md),
  [rbac-modeling.md](rbac-modeling.md),
  [notifications-center.md](notifications-center.md),
  [account-deletion.md](account-deletion.md),
  [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)
- Upstream:
  EU Digital Services Act `eur-lex.europa.eu/eli/reg/2022/2065/oj`,
  EU AI Act `artificialintelligenceact.eu/`,
  UK Online Safety Act
  `www.gov.uk/government/publications/online-safety-act-explainer`,
  NCMEC CyberTipline `report.cybertip.org/`,
  Microsoft PhotoDNA Cloud Service
  `www.microsoft.com/en-us/photodna`,
  Hive Moderation `thehive.ai/moderation`,
  Sightengine `sightengine.com/docs/`.
