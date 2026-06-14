# Onboarding — progressive-disclosure + first-run state-machine + flag-rollout

Onboarding is a cross-cutting surface: it touches routing (where to
send a new user), auth (what do we know about them), feature-flags
(what cohort are they in), analytics (which step dropped off), and
copy (first impression). This recipe codifies the contract for
**progressive-disclosure-per-step**, **server-resolved state-machine
that can't be skipped client-side**, **feature-flag rollout per-cohort
through [feature-flags.md](feature-flags.md)**, and **drop-off
measurement through [analytics.md](analytics.md) without per-user PII**.

Per [principles.md §2.3](../principles.md) (WCAG 2.2 AA — focus
management, no cognitive overload) and [principles.md §2.1](../principles.md)
(Power of 10 — state is server-authoritative), the default posture
is: **onboarding state is a DB column, never a client `localStorage`
flag**, **each step is a distinct route (`/onboarding/profile`,
`/onboarding/invite`)**, **completing a step writes server-side
before the next renders**, **skip/dismiss is a first-class step with
its own audit**, and **every step-transition emits a bounded
`onboarding.step_completed` analytics event with `step` as bounded
enum** (never free-text).

## Related

- [permissions.md](permissions.md) — incomplete onboarding is a
  permission gate (`needsOnboarding` blocks app routes).
- [feature-flags.md](feature-flags.md) — cohort-based step variants
  (A/B onboarding flow) pinned at session start via
  `OnboardingFlowVariant` flag, never re-evaluated mid-flow.
- [analytics.md](analytics.md) — `onboarding.step_completed` +
  `onboarding.step_skipped` + `onboarding.abandoned` bounded events.
- [forms.md](forms.md) — every step is a Superforms form; progress
  persists via server action.
- [auth-oidc.md](auth-oidc.md) — post-login redirect to
  `/onboarding` when `session.onboardingState !== 'complete'`.
- [audit-log.md](audit-log.md) — step completion, skip, abandon all
  written to audit for compliance + product analytics.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — onboarding
  copy is the largest translation surface; every string goes
  through Paraglide.
- [observability.md](observability.md) — `onboarding.step_duration`
  histogram (not analytics) for SLO tracking.
- [toast.md](toast.md) — server-validation errors during a step
  surface via existing toast + inline ProblemError contract.
- [email-deliverability.md](email-deliverability.md) — welcome /
  verify-email / invite-accept transactional emails.
- [principles.md §2.1](../principles.md) — Power of 10 (server
  authoritative).
- [principles.md §2.3](../principles.md) — WCAG 2.2 AA.

## When to reach for what

```text
New-user first-login flow                       → onboarding.md (this)
Feature-discovery tour after release            → feature tours (NOT onboarding — separate concern)
Wizard for complex one-time setup               → onboarding.md pattern, different state key
Product-led growth feature-hints                → hand-off to dedicated tour lib (shepherd.js) — not in scope
Empty-state CTA when data is missing            → component-local, NOT a flow
Re-onboarding after subscription change         → onboarding.md with different state machine
```

**Three build rules:**

1. **Onboarding ≠ feature-tour.** Onboarding is "bring new user to
   first-value"; a tour is "show existing user a new feature."
   Different UX, different state, different success metric. Don't
   conflate. Tours may compose onboarding primitives but live
   elsewhere.
2. **State is a column, not a flag.** `users.onboarding_state` is
   authoritative; client `localStorage.onboardingDone = true` is a
   race-condition waiting to happen. Server-resolved SSR.
3. **Every step is a route.** `/onboarding/profile` is a real URL,
   bookmarkable, back-button works, mid-flow refresh works. No
   single-SPA-modal-takes-over.

### Build-vs-buy

| Option | Use when | Avoid when |
|---|---|---|
| **Custom SvelteKit routes** (DEFAULT) | Full control; tight design integration; server-state | — |
| **Shepherd.js / Intro.js** | Feature tours on existing pages | New-user onboarding (the flow lives in-product-chrome) |
| **UserGuiding / Appcues SaaS** | Marketing-led tours with analytics | Core onboarding (vendor-controlled UX = brittle) |
| **Feature-flagged-modal-overlay** | — | NEVER for core onboarding; modals are hostile to a11y + routing |

**No library for the default path** — onboarding is a SvelteKit +
Superforms + feature-flags + analytics composition, not a product.

## Install

No package. Uses existing stack:

```bash
# already installed for other recipes
pnpm add zod sveltekit-superforms
```

## Shape

```text
src/lib/onboarding/
├── state-machine.ts        OnboardingStep enum + transitions
├── policy.ts               resolveNextStep(user, flow) pure function
└── schemas.ts              OnboardingEvent + per-step form schemas

src/routes/onboarding/
├── +layout.server.ts       guards: session + onboardingState
├── +layout.svelte          chrome (progress indicator, skip link)
├── +page.server.ts         redirects to resolved next step
├── profile/+page.server.ts step 1
├── profile/+page.svelte
├── team/+page.server.ts    step 2
├── team/+page.svelte
├── invite/+page.server.ts  step 3
├── invite/+page.svelte
├── complete/+page.server.ts finalization
└── complete/+page.svelte

supabase/migrations/NNN_onboarding.sql
                            users.onboarding_state column + onboarding_events table
```

## Reference pattern

### 1. State machine — bounded steps + transitions

```typescript
// src/lib/onboarding/state-machine.ts
import { z } from 'zod';

export const OnboardingStep = z.enum([
  'not_started',
  'profile',
  'team',
  'invite',
  'complete',
  'skipped',
]);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const OnboardingFlow = z.enum(['default', 'team_signup', 'solo_signup']);
export type OnboardingFlow = z.infer<typeof OnboardingFlow>;

const FLOWS: Record<OnboardingFlow, OnboardingStep[]> = {
  default:      ['profile', 'team', 'invite', 'complete'],
  team_signup:  ['profile', 'team', 'invite', 'complete'],
  solo_signup:  ['profile', 'complete'],
};

export function resolveNextStep(
  flow: OnboardingFlow,
  current: OnboardingStep,
): OnboardingStep {
  if (current === 'complete' || current === 'skipped') return current;
  const sequence = FLOWS[flow];
  const idx = sequence.indexOf(current);
  if (idx === -1) return sequence[0];
  return sequence[idx + 1] ?? 'complete';
}

export function isStepValid(flow: OnboardingFlow, step: OnboardingStep): boolean {
  if (step === 'not_started' || step === 'skipped' || step === 'complete') return true;
  return FLOWS[flow].includes(step);
}
```

**Five state-machine rules:**

1. **`OnboardingStep` is a bounded Zod enum.** New step = enum
   bump + migration + PR. Free-form strings become
   `profile`/`Profile`/`user_profile` drift.
2. **`OnboardingFlow` is a bounded enum too.** Flow-variants (A/B
   tests, different signup paths) are first-class, not derived
   from config. `solo_signup` and `team_signup` are separate flows,
   not the same flow with a branch.
3. **`resolveNextStep()` is pure** — no IO, takes
   `(flow, current)` returns next. Tested exhaustively. Routing
   calls it; the server action writes the result.
4. **`skipped` and `complete` are terminal.** Both mean "don't show
   onboarding"; the distinction is for analytics (skipped-users
   convert at different rates than completed-users).
5. **`isStepValid(flow, step)` guards direct-URL-navigation.** User
   bookmarks `/onboarding/invite` on `solo_signup` flow → redirect
   to correct step for their flow.

### 2. Server-authoritative state column

```sql
ALTER TABLE users
  ADD COLUMN onboarding_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_state IN ('not_started', 'profile', 'team', 'invite', 'complete', 'skipped')),
  ADD COLUMN onboarding_flow  TEXT NOT NULL DEFAULT 'default'
    CHECK (onboarding_flow IN ('default', 'team_signup', 'solo_signup')),
  ADD COLUMN onboarding_started_at   TIMESTAMPTZ,
  ADD COLUMN onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE onboarding_events (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  step          TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('started', 'completed', 'skipped', 'abandoned')),
  flow          TEXT NOT NULL,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX onboarding_events_user_idx ON onboarding_events (user_id, created_at DESC);
CREATE INDEX onboarding_events_step_action_idx ON onboarding_events (step, action);
```

**Four state-column rules:**

1. **CHECK constraint mirrors Zod enum.** DB and application layer
   agree; migration fails fast if they drift.
2. **`onboarding_flow` persisted at signup** — the flow chosen at
   signup doesn't change mid-flow even if flag evaluation changes.
   Otherwise a user goes `profile → team → invite`, then a flag
   flip sends them back to `profile` (via `solo_signup` flow).
   Pinned.
3. **`onboarding_events` is append-only** — every transition a row.
   Duplicates (retry, back-button, re-submit) → separate rows with
   distinct `created_at`; dedup is a query concern, not a write
   concern.
4. **`duration_ms` from `started → completed`** of that step,
   populated on the completion event. Feeds the observability
   histogram.

### 3. Route-level guard + redirect

```typescript
// src/routes/onboarding/+layout.server.ts
import type { LayoutServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { resolveNextStep, isStepValid } from '$lib/onboarding/state-machine';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const user = locals.session?.user;
  if (!user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

  if (user.onboardingState === 'complete' || user.onboardingState === 'skipped') {
    throw redirect(303, '/app');
  }

  const currentPath = url.pathname.split('/').pop();
  if (currentPath && currentPath !== 'onboarding' &&
      !isStepValid(user.onboardingFlow, currentPath as never)) {
    const next = resolveNextStep(user.onboardingFlow, user.onboardingState);
    throw redirect(303, `/onboarding/${next}`);
  }

  return {
    flow: user.onboardingFlow,
    currentStep: user.onboardingState,
  };
};
```

```typescript
// src/routes/onboarding/+page.server.ts — the index redirects to current step
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { resolveNextStep } from '$lib/onboarding/state-machine';

export const load: PageServerLoad = async ({ locals }) => {
  const next = resolveNextStep(
    locals.session.user.onboardingFlow,
    locals.session.user.onboardingState,
  );
  throw redirect(303, `/onboarding/${next}`);
};
```

**Four routing rules:**

1. **The layout is the gatekeeper.** Not per-step-server-file —
   otherwise every step duplicates the guard and they drift.
2. **`/onboarding` redirects to the resolved step.** A bookmark of
   `/onboarding` should always land on "where you left off,"
   never a landing page.
3. **App routes gate-check `onboardingState !== 'complete'`.** In
   `src/hooks.server.ts` or `(app)/+layout.server.ts`, block with
   a redirect to `/onboarding`. [permissions.md](permissions.md)
   pattern.
4. **`?next=` parameter preserves post-onboarding destination.**
   User clicks a deep link, gets redirected to onboarding, and
   lands where they intended after completion.

### 4. Step form with server action

```typescript
// src/routes/onboarding/profile/+page.server.ts
import type { Actions, PageServerLoad } from './$types';
import { superValidate, fail } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/db';
import { recordOnboardingEvent } from '$lib/onboarding/events';
import { resolveNextStep } from '$lib/onboarding/state-machine';
import { now } from '$lib/clock';

const ProfileSchema = z.object({
  displayName: z.string().min(1).max(100),
  timezone: z.string().max(64),
  marketingOptIn: z.boolean().default(false),
});

export const load: PageServerLoad = async ({ locals }) => {
  const form = await superValidate(
    { displayName: locals.session.user.displayName ?? '', timezone: 'UTC', marketingOptIn: false },
    zod(ProfileSchema),
  );

  if (locals.session.user.onboardingState === 'not_started') {
    await db.none(
      `UPDATE users SET onboarding_state = 'profile', onboarding_started_at = $1
         WHERE id = $2 AND onboarding_state = 'not_started'`,
      [now(), locals.session.user.id],
    );
    await recordOnboardingEvent({
      userId: locals.session.user.id,
      step: 'profile',
      action: 'started',
      flow: locals.session.user.onboardingFlow,
    });
  }

  return { form };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, zod(ProfileSchema));
    if (!form.valid) return fail(400, { form });

    await db.tx(async (t) => {
      await t.none(
        `UPDATE users
            SET display_name = $1, timezone = $2, marketing_opt_in = $3
          WHERE id = $4`,
        [form.data.displayName, form.data.timezone, form.data.marketingOptIn, locals.session.user.id],
      );

      const next = resolveNextStep(locals.session.user.onboardingFlow, 'profile');
      await t.none(
        `UPDATE users SET onboarding_state = $1 WHERE id = $2`,
        [next, locals.session.user.id],
      );
    });

    await recordOnboardingEvent({
      userId: locals.session.user.id,
      step: 'profile',
      action: 'completed',
      flow: locals.session.user.onboardingFlow,
    });

    const next = resolveNextStep(locals.session.user.onboardingFlow, 'profile');
    throw redirect(303, `/onboarding/${next}`);
  },
};
```

**Six step-action rules:**

1. **State-advance is in the same tx as the mutation.** Otherwise
   the user fills the form, DB write succeeds, state-advance
   fails, and they're stuck on `profile` forever with a saved
   profile.
2. **Idempotent on revisit.** The `load` upserts `onboarding_state`
   with `WHERE onboarding_state = 'not_started'` so a refresh
   doesn't re-record `started`. Only-once semantics.
3. **`throw redirect` after the action** — never return the next
   step's data in the same response. Each step is a separate
   request-response for a11y + back-button correctness.
4. **No skip-button on mandatory steps.** `profile` has no "skip
   for now"; `invite` does (can always invite later). The
   state-machine encodes this, not per-component logic.
5. **Server action, not client fetch.** Superforms action handles
   progressive enhancement; works without JS; is the a11y-correct
   submit contract.
6. **Analytics event after commit, not before.** If the tx fails,
   no event. Analytics-count matches DB-truth.

### 5. Step UI with progress + focus management

```svelte
<!-- src/routes/onboarding/+layout.svelte -->
<script lang="ts">
  import { page } from '$app/stores';
  import * as m from '$paraglide/messages';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: any } = $props();

  const sequence = $derived(data.flow === 'solo_signup' ? ['profile', 'complete'] : ['profile', 'team', 'invite', 'complete']);
  const currentIndex = $derived(
    sequence.indexOf($page.url.pathname.split('/').pop() ?? 'profile'),
  );
  const progress = $derived(Math.max(0, (currentIndex / (sequence.length - 1)) * 100));
</script>

<div class="onboarding-shell">
  <nav aria-label={m.onboarding_progress_label()}>
    <ol class="onboarding-steps">
      {#each sequence as step, i}
        <li
          aria-current={i === currentIndex ? 'step' : undefined}
          data-status={i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming'}
        >
          {m[`onboarding_step_${step}_label`]()}
        </li>
      {/each}
    </ol>
    <div
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={m.onboarding_progress_text({ step: currentIndex + 1, total: sequence.length })}
    />
  </nav>

  <main tabindex="-1">
    {@render children()}
  </main>
</div>
```

**Six a11y rules:**

1. **`<nav aria-label>` wrapping the step indicator** — screen
   readers announce it as a landmark for orientation.
2. **`<ol>` with `aria-current="step"`** for the current step —
   canonical WAI-ARIA pattern. Never `<div class="step active">`.
3. **`role="progressbar"` with `aria-valuenow/min/max/valuetext`.**
   The `valuetext` is the human-readable form ("Step 2 of 4"),
   localized.
4. **`<main tabindex="-1">` receives programmatic focus** after
   navigation via a small `afterNavigate` hook — otherwise SR
   users lose their place on every step transition.
5. **No modal pattern.** Onboarding is the page, not an overlay.
   Overlays trap focus poorly and are hostile to bookmarking.
6. **Paraglide for every string.** Step labels, progress text,
   error messages, button copy — all through `m.*`. First
   impression is also the first localization test.

## Feature-flag rollout — cohort-pinned

```typescript
// src/hooks.server.ts (excerpt)
import { openfeature } from '$lib/flags';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.locals.session?.user) {
    const user = event.locals.session.user;
    if (user.onboardingFlow === 'default' && user.createdAt > ONBOARDING_V2_START) {
      const variant = await openfeature
        .getClient()
        .getStringValue('onboarding_flow_variant', 'default', {
          targetingKey: user.id,
          attributes: { plan: user.plan, createdAt: user.createdAt.toISOString() },
        });
      if (variant !== 'default') {
        await db.none(
          `UPDATE users SET onboarding_flow = $1
             WHERE id = $2 AND onboarding_state = 'not_started'`,
          [variant, user.id],
        );
      }
    }
  }
  return resolve(event);
};
```

**Four flag-rollout rules:**

1. **Flag evaluated once, pinned at state column.** Mid-flow flag
   flips never rewind a user. The flow column is source-of-truth.
2. **Pin only for `not_started` users.** Existing in-flight users
   stay on their current flow. Otherwise variants mix.
3. **`targetingKey: user.id` for stable cohort assignment.** Same
   user always sees same variant across sessions.
4. **Audit flow-assignment.** `onboarding_events` with
   `action: 'started'` records `flow` — analysis can join to
   flag-exposure events to correlate variant → conversion.

## Analytics events — bounded catalog

```typescript
// src/lib/onboarding/events.ts
import { track } from '$lib/analytics';
import { db } from '$lib/db';
import { uuidv7 } from '$lib/observability';
import { now } from '$lib/clock';

interface OnboardingEventInput {
  userId: string;
  step: 'profile' | 'team' | 'invite' | 'complete';
  action: 'started' | 'completed' | 'skipped' | 'abandoned';
  flow: 'default' | 'team_signup' | 'solo_signup';
  durationMs?: number;
}

export async function recordOnboardingEvent(input: OnboardingEventInput): Promise<void> {
  await db.none(
    `INSERT INTO onboarding_events (id, user_id, step, action, flow, duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uuidv7(), input.userId, input.step, input.action, input.flow, input.durationMs ?? null, now()],
  );

  track(`onboarding_${input.action}`, {
    step: input.step,
    flow: input.flow,
  });
}
```

**Four analytics rules:**

1. **Events are bounded past-tense-verbs.** `onboarding_started`,
   `onboarding_step_completed`, `onboarding_skipped`,
   `onboarding_abandoned`. Match
   [analytics.md](analytics.md) naming.
2. **Properties are bounded enums.** `step` and `flow` are the
   only event properties. Never user-filled strings.
3. **No PII in events** — no email, no display name, no company.
   User-ID is server-side-only; analytics sees aggregated.
4. **Double-write: DB + analytics.** DB is the audit-of-record
   (legal / dispute); analytics is the aggregate-funnel. They
   diverge on sampling and retention; both are needed.

## Abandonment detection — daily cron

```typescript
// src/routes/api/cron/onboarding-abandon/+server.ts
import { withCronRun } from '../_shared/runner';
import { verifyCronRequest } from '../_shared/authn';
import { db } from '$lib/db';
import { subHours } from 'date-fns';
import { now } from '$lib/clock';

export const POST: RequestHandler = async ({ request }) => {
  verifyCronRequest(request);

  return withCronRun('onboarding-abandon', async () => {
    const cutoff = subHours(now(), 48);
    const stuck = await db.manyOrNone<{ id: string; state: string; flow: string }>(
      `SELECT id, onboarding_state AS state, onboarding_flow AS flow
         FROM users
        WHERE onboarding_state NOT IN ('not_started','complete','skipped')
          AND onboarding_started_at < $1`,
      [cutoff],
    );

    for (const u of stuck) {
      await recordOnboardingEvent({
        userId: u.id,
        step: u.state as never,
        action: 'abandoned',
        flow: u.flow as never,
      });
    }

    return { processed: stuck.length, skipped: 0 };
  });
};
```

**Three abandonment rules:**

1. **48h is the default abandonment threshold.** Shorter → noise
   (user went to lunch); longer → stale funnel data. Tune per
   product.
2. **`abandoned` is a one-time event per user.** A user who starts
   again is `started` again — fresh funnel attempt. Don't
   double-emit.
3. **Drives re-engagement email.** [email-deliverability.md](email-deliverability.md)
   listens for `onboarding.abandoned` and sends the re-engage
   template via [structured-emails.md](structured-emails.md).

## Observability — bounded attributes

```text
Span:            onboarding.step.<step>          (e.g. onboarding.step.profile)
Attributes:      onboarding.step                 (bounded enum)
                 onboarding.flow                 (bounded enum)
                 onboarding.action               (started | completed | skipped)
                 onboarding.duration_bucket      ('<5s' | '5-30s' | '30s-5min' | '>5min')
Metrics:         onboarding.step.duration        histogram, labels: step, flow
                 onboarding.funnel.count         counter, labels: step, action, flow
                 onboarding.abandonment.rate     gauge (daily cron), labels: flow
```

**Four observability rules:**

1. **Span per step, not per flow** — the flow is an attribute. A
   flow's total duration is sum-of-step-durations.
2. **`onboarding.duration_bucket` bucketed** — raw ms is for the
   histogram; the bucket label keeps cardinality bounded for
   alerts.
3. **`userId` span attribute only** — never a metric label. Same
   rule as every other bounded-label surface.
4. **Alert on funnel drop-off deviation**, not absolute drop-off.
   A 70% step-2 completion rate is concerning only if baseline is
   85%. Alerts use percentile-change, not threshold.

## Testing — three lanes

```typescript
// unit: state-machine
it('resolves next step for each flow', () => {
  expect(resolveNextStep('default', 'profile')).toBe('team');
  expect(resolveNextStep('solo_signup', 'profile')).toBe('complete');
  expect(resolveNextStep('default', 'complete')).toBe('complete');
});

// integration: guard redirects stale state
it('bookmark to invalid step for flow redirects to valid step', async () => {
  const user = seedUser({ onboardingFlow: 'solo_signup', onboardingState: 'profile' });
  const res = await app.request('/onboarding/invite', { cookies: authCookie(user) });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('/onboarding/complete');
});

// e2e: Playwright full happy path + a11y
test('onboarding happy path is axe-clean', async ({ page }) => {
  await signUp(page);
  await expect(page).toHaveURL(/\/onboarding\/profile/);
  await page.fill('input[name="displayName"]', 'Test User');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/onboarding\/team/);

  const axe = await axeAnalyze(page);
  expect(axe.violations).toHaveLength(0);
});
```

**Four test rules:**

1. **Exhaustive state-machine tests.** Cartesian product of
   `(flow, current) → next`. Cheap; catches regressions when
   flows change.
2. **Bookmark-to-invalid-step test.** Core correctness guarantee;
   easy to regress when refactoring guards.
3. **E2E + axe on the onboarding flow.** Onboarding is the first
   impression; a11y regressions here lose users before they start.
4. **Funnel test with seeded cohort.** Emit 100 fake users, assert
   the funnel aggregates match. Catches event-naming drift before
   analytics dashboards break.

## Anti-patterns

1. **`localStorage.onboardingDone = true`.** Bypassable, not
   cross-device, no audit. State is a DB column.
2. **Single-SPA-modal overlay.** Traps focus, breaks back-button,
   no deep-link. Each step is a route.
3. **Free-text `step` values.** `"profile-v2"` / `"profileStep"`
   drift. Bounded enum always.
4. **Client-side analytics only.** Analytics sees the user hit
   step 3, but DB says state = step 1. Diverges; no audit for
   billing disputes or legal. Double-write.
5. **Flag re-evaluated mid-flow.** User sees `profile → team`,
   flag flips, next refresh sends them to `team_alt` they've
   never seen. Pin at signup.
6. **Skip button on mandatory steps.** "Set up your account" with
   a skip is not mandatory. Either enforce it or remove it.
7. **No re-engagement for abandoned flows.** A 48h-old stuck user
   is likely lost. Email-send via
   [email-deliverability.md](email-deliverability.md) is
   cheap and effective.
8. **Loading animations as "step transitions."** A step is a
   route; a route is a page-load. Don't fake it with a splash.
9. **Forgetting `aria-current="step"`.** SR users can't tell
   where they are in the flow.
10. **Mixed-language onboarding.** Fallback-to-English-on-missing-
    key is extra jarring during onboarding. Block release on
    untranslated onboarding keys via [i18n-runtime-strategy.md](i18n-runtime-strategy.md).
11. **Non-idempotent `started` event emission.** Refresh-loop
    generates 500 `started` rows, poisons funnel math. Guard
    with `WHERE onboarding_state = 'not_started'`.
12. **PII in analytics events.** `displayName` / `email` in
    events = GDPR violation + data-warehouse contamination.
13. **Hiding onboarding behind a feature flag default-off.** New
    users hit the app without onboarding and get confused. The
    flag variants are between flows, never "on/off."
14. **Onboarding as a long form on one page.** Cognitive overload
    + validation-error stampede + no progress feedback.
    Progressive disclosure across routes.
15. **Reset-onboarding toggle in the user settings.** Sounds
    helpful, breaks analytics, reopens legal-consent questions.
    If a flow change needs re-onboarding, run a migration with
    an ADR.

## References

- [ADR-0019 — structured errors](../adr/0019-structured-errors.md) —
  step-validation errors flow through Superforms + ProblemError.
- [ADR-0023 — observability](../adr/0023-observability.md) — bounded
  `onboarding.step` + `onboarding.flow` labels.
- [feature-flags.md](feature-flags.md) — cohort-pinned variants.
- [forms.md](forms.md) — Superforms pattern per step.
- [analytics.md](analytics.md) — event catalog discipline.
- [permissions.md](permissions.md) — gating app access on
  `onboardingState !== 'complete'`.
- [audit-log.md](audit-log.md) — step-transition audit.
- [email-deliverability.md](email-deliverability.md) — welcome +
  re-engagement sends.
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — Paraglide
  for every onboarding string.
- [WAI-ARIA Authoring Practices — progress bar](https://www.w3.org/WAI/ARIA/apg/patterns/) — `role="progressbar"` contract.
- [Nielsen Norman Group — progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — UX pattern references.
