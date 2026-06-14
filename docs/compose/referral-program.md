# referral-program.md — composition recipe

> **Invite codes → attribution → reward.** A referral program turns
> existing users into a growth channel, with three discrete
> sub-systems that must compose cleanly: **code issuance** (unique
> per-referrer, sometimes per-campaign), **attribution** (which
> signup belongs to which referrer, under what rules), and **reward
> payout** (credit, cash, Stripe coupon, donation). Per
> [ADR-0019](../adr/0019-http-client-and-error-model.md) every
> state-changing endpoint is RFC 9457 + Idempotency-Key; per
> [ADR-0023](../adr/0023-compliance-audit-log-contract.md) every
> reward grant is audit-logged; per
> [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md) the
> attribution cookie is `__Host-ref` with a 30-day TTL.

> **Attribution is where programs die.** Without clear rules — first-
> touch vs. last-touch, cookie window, self-referral block, fraud
> heuristics — every reward dispute becomes adversarial. The recipe
> ships a single deterministic rule set with overrides captured in
> the audit log.

## Related

- [analytics.md](analytics.md) — signup event carries the resolved
  `referrerId`; downstream funnels split by referral source
- [payments.md](payments.md) — Stripe coupons are one reward
  currency; account-credit is the other
- [billing-tax.md](billing-tax.md) — cash rewards are taxable income
  above threshold; 1099-MISC (US) / DAC7 (EU) reporting
- [audit-log.md](audit-log.md) — every grant / reversal / adjustment
- [rate-limiting.md](rate-limiting.md) — per-IP invite-redemption bucket
- [rbac-modeling.md](rbac-modeling.md) — `referral:admin` for manual
  adjustments
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) —
  program is flag-gated during pilot
- [structured-emails.md](structured-emails.md) — invite email +
  reward-earned notification
- [cookies-authoritative.md](cookies-authoritative.md) —
  `__Host-ref` attribute matrix
- [fraud-detection patterns] — referral fraud overlaps with general
  fraud; see [content-moderation.md](content-moderation.md) for the
  review-queue pattern
- [ADR-0019](../adr/0019-http-client-and-error-model.md),
  [ADR-0023](../adr/0023-compliance-audit-log-contract.md),
  [ADR-0034](../adr/0034-auth-cookie-and-csrf-contract.md)

## When to use what

```text
Consumer SaaS viral loop (Dropbox-style)           → this recipe
                                                     codes per-user, give-and-get rewards
B2B SaaS partner program                           → this recipe + partner portal
                                                     multi-tier, per-partner commission
Affiliate network (Impact.com / PartnerStack)      → opt-in integration, NOT this recipe
                                                     third-party owns attribution
Influencer campaign (discount codes)               → Stripe promotion codes
                                                     simpler; no per-signup attribution
Employee referral program                          → this recipe + HRIS integration
                                                     taxable comp; separate tax flow
Win-back / reactivation coupon                     → Stripe promotion codes, not this recipe
Customer-advocacy points system                    → loyalty program; different surface
Referral-gated beta access                         → invite codes only; no reward payout
```

## Attribution rules (the hard part)

```text
Touch model:         FIRST-TOUCH (cookie set on first referred click wins)
                     Reason: users expect credit for introducing the person
Cookie window:       30 days
Cross-device:        Collapsed at signup by email (not device fingerprint)
Self-referral:       Rejected. `referrer.accountId === signup.accountId` by email.
Same household/IP:   Flagged for review (not auto-rejected); K-anonymity bucket
Reward payout:       Gated on `qualifyingEvent`:
                       - Consumer:  signup verified + plan upgrade OR 30-day retention
                       - B2B:       paid-plan activation (first invoice paid)
                     Not on signup alone — fraud resistance.
Reversal window:     Reward clawed back if referred user refunds within 90 days
                       - Credit rewards: simply not applied; visible as "pending"
                       - Cash rewards: locked until reversal window closes
Max rewards:         50 paid referrals per referrer per year; above requires review
Currency mixing:     One reward kind per referrer (avoid mixing credit + cash)
```

## Shape — bounded Zod

```ts
// packages/growth/src/referral/types.ts
import { z } from 'zod';

export const ProgramKind = z.enum(['give_get_credit', 'give_get_cash', 'b2b_commission']);
export type ProgramKind = z.infer<typeof ProgramKind>;

export const RewardCurrency = z.enum(['account_credit_cents', 'cash_cents', 'stripe_coupon']);

export const Program = z.object({
  id: z.string().uuid(),
  kind: ProgramKind,
  name: z.string().min(1).max(80),
  status: z.enum(['draft', 'live', 'paused', 'archived']),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  referrerReward: z.object({
    currency: RewardCurrency,
    amountMinor: z.number().int().min(0).max(50_000_00),  // max $50k per reward
    stripeCouponId: z.string().optional(),
  }),
  refereeReward: z.object({
    currency: RewardCurrency,
    amountMinor: z.number().int().min(0).max(50_000_00),
    stripeCouponId: z.string().optional(),
  }),
  cookieWindowDays: z.number().int().min(1).max(90).default(30),
  maxPerReferrerPerYear: z.number().int().min(1).max(10000).default(50),
});
export type Program = z.infer<typeof Program>;

// Codes are short, human-typable, unambiguous (Crockford base32, no 0/O/I/L).
export const ReferralCode = z.object({
  code: z.string().regex(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/),
  programId: z.string().uuid(),
  referrerAccountId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  disabledAt: z.string().datetime({ offset: true }).nullable(),
});

export const Attribution = z.object({
  id: z.string().uuid(),
  programId: z.string().uuid(),
  referrerAccountId: z.string().uuid(),
  refereeAccountId: z.string().uuid(),
  code: z.string(),
  firstTouchAt: z.string().datetime({ offset: true }),
  signupAt: z.string().datetime({ offset: true }),
  qualifyingEventAt: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(['pending', 'qualified', 'rewarded', 'reversed', 'rejected']),
  rejectionReason: z.enum([
    'self_referral',
    'same_email_domain_employee',
    'fraud_flag',
    'over_annual_cap',
    'program_ended',
    'admin_reversal',
  ]).nullable(),
});
export type Attribution = z.infer<typeof Attribution>;
```

Invariants baked in:
- Code alphabet is **Crockford base32 without ambiguous chars** —
  users type them wrong half as often as with full base36.
- Reward amount capped at $50,000 minor-units — a catastrophic bug
  cannot drain the treasury in one row.
- `status` transitions are finite; invalid transitions rejected at the
  DB layer via check constraints.

## Reference pattern

### 1. Code issuance

```ts
// packages/growth/src/referral/codes.ts
import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // 30 chars

export function generateCode(): string {
  const buf = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[buf[i] % 30];
  return out;
}

export async function issueCodeForReferrer(accountId: string, programId: string) {
  // One code per (account, program). If exists, return it. Idempotent.
  const existing = await db.select().from(referralCode)
    .where(and(eq(referralCode.referrerAccountId, accountId), eq(referralCode.programId, programId))).limit(1);
  if (existing.length > 0) return existing[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const [row] = await db.insert(referralCode).values({
        code,
        programId,
        referrerAccountId: accountId,
        createdAt: new Date().toISOString(),
        disabledAt: null,
      }).returning();
      return row;
    } catch (e) {
      if (!(e instanceof UniqueViolationError)) throw e;
      // collision; try again
    }
  }
  throw new Error('code_generation_exhausted');
}
```

Collision probability at 30^8 = 656 billion is negligible until
~100M referrers, at which point we add another character.

### 2. Attribution — set cookie on landing, resolve at signup

```ts
// src/routes/r/[code]/+server.ts
import { redirect } from '@sveltejs/kit';
import { loadCodeByValue } from '$lib/server/referral';

export async function GET({ params, cookies, url }) {
  const row = await loadCodeByValue(params.code.toUpperCase());
  if (!row || row.disabledAt) {
    // Unknown code — no cookie, redirect to normal landing.
    throw redirect(303, '/?r=invalid');
  }
  const program = await loadProgram(row.programId);
  if (program.status !== 'live') throw redirect(303, '/');

  // First-touch: only set if not already present.
  const existing = cookies.get('__Host-ref');
  if (!existing) {
    cookies.set('__Host-ref', JSON.stringify({
      code: row.code,
      referrerAccountId: row.referrerAccountId,
      programId: row.programId,
      firstTouchAt: new Date().toISOString(),
    }), {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: program.cookieWindowDays * 86400,
    });
  }

  // Destination is the campaign-supplied landing, or '/'
  const dest = url.searchParams.get('to') === '/signup' ? '/signup' : '/';
  throw redirect(303, dest);
}
```

Why `__Host-ref` is `HttpOnly`:
- The referral cookie doesn't need JS access.
- HttpOnly prevents `document.cookie` leak via XSS from seeing the
  referrer graph (privacy: referrer identity).

### 3. Attribution resolution at signup

```ts
// src/routes/signup/+page.server.ts — partial
export const actions = {
  default: async ({ request, cookies, locals }) => {
    const form = await superValidate(request, zod(SignupForm));
    if (!form.valid) return fail(400, { form });
    const account = await createAccount(form.data);

    const refCookie = cookies.get('__Host-ref');
    if (refCookie) {
      try {
        const ref = JSON.parse(refCookie) as {
          code: string;
          referrerAccountId: string;
          programId: string;
          firstTouchAt: string;
        };
        await resolveAttribution({
          ...ref,
          refereeAccountId: account.id,
          signupAt: new Date().toISOString(),
          signupEmail: form.data.email,
          signupIp: getClientAddress(),
        });
      } catch (e) {
        // Bad cookie → no attribution, continue signup.
        logger.warn('ref_cookie_invalid', { error: e });
      }
      cookies.delete('__Host-ref', { path: '/' });
    }

    throw redirect(303, '/welcome');
  },
};
```

```ts
// packages/growth/src/referral/resolve.ts
export async function resolveAttribution(input: {
  code: string;
  referrerAccountId: string;
  programId: string;
  firstTouchAt: string;
  refereeAccountId: string;
  signupAt: string;
  signupEmail: string;
  signupIp: string;
}) {
  const program = await loadProgram(input.programId);
  if (!program || program.status !== 'live') return reject('program_ended');

  // Self-referral by email (most common fraud).
  const referrerEmail = await loadAccountEmail(input.referrerAccountId);
  if (emailNormalize(referrerEmail) === emailNormalize(input.signupEmail)) {
    return reject('self_referral');
  }

  // Shared domain heuristic (ignore for consumer gmail; enforce for companies).
  if (sameCorporateDomain(referrerEmail, input.signupEmail)) {
    return reject('same_email_domain_employee');
  }

  // Annual cap.
  const thisYearCount = await countQualifiedThisYear(input.referrerAccountId);
  if (thisYearCount >= program.maxPerReferrerPerYear) {
    return reject('over_annual_cap');
  }

  // Fraud signals — IP, device, velocity.
  const fraudScore = await computeFraudScore({
    referrerId: input.referrerAccountId,
    refereeId: input.refereeAccountId,
    signupIp: input.signupIp,
  });
  if (fraudScore >= 0.7) return flagForReview({ ...input, fraudScore });

  // Persist as pending; qualifies on qualifyingEvent.
  return insertAttribution({
    ...input,
    status: 'pending',
  });

  function reject(reason: Attribution['rejectionReason']) {
    return insertAttribution({ ...input, status: 'rejected', rejectionReason: reason });
  }
}
```

### 4. Qualifying event → reward grant

```ts
// packages/growth/src/referral/qualify.ts
// Called from billing webhook on first paid invoice OR scheduled job
// at 30-day retention mark.
export async function markQualifyingEvent(refereeAccountId: string, kind: 'paid_invoice' | 'retention_30d') {
  const attr = await loadPendingAttributionForReferee(refereeAccountId);
  if (!attr) return;
  if (attr.status !== 'pending') return;

  await db.transaction(async (tx) => {
    await tx.update(attribution)
      .set({ status: 'qualified', qualifyingEventAt: new Date().toISOString() })
      .where(eq(attribution.id, attr.id));
    await enqueueReward({ attributionId: attr.id });
  });

  await writeAuditEvent({
    kind: 'referral.qualified',
    subjectId: attr.referrerAccountId,
    payload: { attributionId: attr.id, qualifyingKind: kind },
  });
}
```

Rewards are enqueued, not granted inline, because cash grants involve
Stripe payouts which have their own retry semantics.

```ts
// packages/growth/src/referral/reward-worker.ts
export async function processReward(job: { attributionId: string }) {
  const attr = await loadAttribution(job.attributionId);
  if (attr.status !== 'qualified') return;

  const program = await loadProgram(attr.programId);

  // Idempotent: check if a reward row already exists for this attribution.
  const existing = await loadRewardForAttribution(attr.id);
  if (existing) return;

  await db.transaction(async (tx) => {
    // Referrer reward.
    await grantReward(tx, {
      accountId: attr.referrerAccountId,
      attributionId: attr.id,
      currency: program.referrerReward.currency,
      amountMinor: program.referrerReward.amountMinor,
      stripeCouponId: program.referrerReward.stripeCouponId,
      role: 'referrer',
    });
    // Referee reward.
    await grantReward(tx, {
      accountId: attr.refereeAccountId,
      attributionId: attr.id,
      currency: program.refereeReward.currency,
      amountMinor: program.refereeReward.amountMinor,
      stripeCouponId: program.refereeReward.stripeCouponId,
      role: 'referee',
    });
    await tx.update(attribution).set({ status: 'rewarded' }).where(eq(attribution.id, attr.id));
  });

  await enqueueEmail({
    template: 'referral-rewarded',
    to: attr.referrerAccountId,
    data: { attributionId: attr.id },
  });
}
```

### 5. Reversal on refund

```ts
// Triggered from Stripe webhook `charge.refunded` within 90 days.
export async function handleRefundReversal(refereeAccountId: string, refundedAt: string) {
  const attr = await loadQualifiedAttributionForReferee(refereeAccountId);
  if (!attr) return;

  const ageDays = (Date.parse(refundedAt) - Date.parse(attr.qualifyingEventAt!)) / 86400_000;
  if (ageDays > 90) return; // outside reversal window

  await db.transaction(async (tx) => {
    await reverseReward(tx, { attributionId: attr.id });
    await tx.update(attribution).set({ status: 'reversed' }).where(eq(attribution.id, attr.id));
  });
  await writeAuditEvent({
    kind: 'referral.reversed',
    subjectId: attr.referrerAccountId,
    payload: { attributionId: attr.id, reason: 'referee_refund', ageDays },
  });
}
```

### 6. Referrer UI — dashboard

```svelte
<!-- src/routes/account/referrals/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const shareUrl = $derived(`https://example.com/r/${data.code}`);
</script>

<h1>Invite friends, earn {data.program.referrerReward.amountMinor / 100}€</h1>

<section aria-labelledby="your-code">
  <h2 id="your-code">Your invite link</h2>
  <p>
    <code>{shareUrl}</code>
    <button onclick={() => navigator.clipboard.writeText(shareUrl)}>Copy</button>
  </p>
</section>

<section aria-labelledby="your-stats">
  <h2 id="your-stats">Your referrals</h2>
  <dl>
    <dt>Invited</dt><dd>{data.stats.totalSignups}</dd>
    <dt>Qualified</dt><dd>{data.stats.qualified}</dd>
    <dt>Pending</dt><dd>{data.stats.pending}</dd>
    <dt>Earned</dt><dd>{data.stats.totalEarnedMinor / 100}€</dd>
  </dl>
</section>

<section>
  <h2>Recent referrals</h2>
  <ul>
    {#each data.recent as r}
      <li>
        <span>{r.signupAt.slice(0, 10)}</span>
        <span>{r.refereeInitial}.{r.refereeInitialLast}</span>
        <span class="status-{r.status}">{r.status}</span>
      </li>
    {/each}
  </ul>
</section>
```

**Privacy:** the recent-referrals list shows only initials or
obfuscated identifiers, not full email/name of the referee. Referrers
don't need to know exactly who signed up.

### 7. Admin manual-adjustment

```ts
// src/routes/admin/referrals/[id]/+server.ts
export async function POST({ params, request, locals }) {
  if (!locals.user?.permissions.includes('referral:admin')) throw error(403);
  const { action, note } = await request.json();

  const attr = await loadAttribution(params.id);
  if (!attr) throw error(404);

  if (action === 'force_qualify') {
    await markAttributionQualifiedManual(attr.id, locals.user.id, note);
  } else if (action === 'force_reverse') {
    await reverseRewardManual(attr.id, locals.user.id, note);
  } else if (action === 'unreject') {
    await unrejectAttribution(attr.id, locals.user.id, note);
  } else {
    throw error(400, { message: 'unknown_action' });
  }

  await writeAuditEvent({
    kind: `referral.admin.${action}`,
    subjectId: locals.user.id,
    payload: { attributionId: attr.id, note, beforeStatus: attr.status },
  });

  return json({ ok: true });
}
```

Manual overrides always land in the audit log with the operator id
and a required note; otherwise an adversarial admin can silently
grant themselves rewards.

### 8. Tax + 1099/DAC7 reporting

For cash rewards, reporting thresholds apply: US 1099-MISC at $600/yr,
EU DAC7 at €2,000/yr (platform operators). See
[billing-tax.md](billing-tax.md) for the tax pipeline; the referral
program emits a `taxable_income_event` per qualified cash reward.

```ts
await emitTaxableIncomeEvent({
  accountId: attr.referrerAccountId,
  amountMinor: program.referrerReward.amountMinor,
  currency: 'USD',
  category: 'referral_reward',
  occurredAt: attr.qualifyingEventAt,
});
```

## A11y invariants

- Invite-link input uses a real `<code>` with a visible "Copy" button;
  never hide the link behind a tooltip.
- Copy action gives `role="status"` feedback: "Link copied" in an
  `aria-live="polite"` region.
- Stats `<dl>` with `<dt>` / `<dd>` — SR users navigate by term.
- Status labels ("pending", "qualified", "reversed") are real text,
  not color-only badges. Color is secondary.
- Email input for "invite by email" has `autocomplete="email"` and a
  proper `<label>`.

## Security invariants

- **Attribution cookie is `__Host-ref`**, `HttpOnly`, `Secure`,
  `SameSite=Lax`, max-age = program window.
- Code lookup is **rate-limited** per IP (50/hour) — prevents brute-
  force enumeration of codes.
- Self-referral check by **normalized email** (lowercased, `+`-stripped
  for Gmail; configurable per domain).
- Fraud score uses **device fingerprint + IP + velocity**; score ≥0.7
  routes to manual review, never auto-rewards.
- Reward amount is server-only; client never sends the amount.
- Cash payouts require **KYC on the referrer account** above $600/year
  (US) — gate in the worker.
- Reversal within 90 days is automatic; beyond that requires an admin
  with a note.
- Admin adjustments are **append-only audit** — never silent.

## Testing

```ts
// tests/referral/attribution.test.ts
test('self-referral rejected by normalized email', async () => {
  const result = await resolveAttribution({
    code: 'ABCD1234',
    referrerAccountId: 'r1',
    programId: 'p1',
    firstTouchAt: '2026-04-01T00:00:00Z',
    refereeAccountId: 'r1',
    signupAt: '2026-04-01T01:00:00Z',
    signupEmail: 'alice+promo@example.com',
    signupIp: '1.2.3.4',
  });
  expect(result.status).toBe('rejected');
  expect(result.rejectionReason).toBe('self_referral');
});
```

## Anti-patterns

1. **Trusting client-sent `referralCode` on signup** without cookie —
   bypass attribution rules; use the cookie or a server-resolved URL.
2. **Last-touch attribution** without explicit consumer expectation
   — surprises the first-touch referrer.
3. **Immediate reward on signup** — fraud vector; qualify on paid
   plan OR 30-day retention.
4. **No reversal window** — refunds drain the program; lock cash
   90 days.
5. **UUID codes** — unreadable, untypable. Use 8-char Crockford.
6. **Ambiguous alphabet (`0`/`O`, `1`/`I`/`L`)** — support tickets.
7. **Revealing referee's full email/name to referrer** — privacy leak
   that feels creepy and often violates GDPR.
8. **Unbounded `maxPerReferrerPerYear`** — fraud vector.
9. **Stacking multiple referrer cookies** — last-touch creeps in.
   First-touch: set only if empty.
10. **No rate-limit on `/r/:code`** — enumerate valid codes.
11. **Mixing reward currencies per referrer** — support nightmare
    (partial credit + partial cash).
12. **Cash rewards without KYC above threshold** — legal/tax risk.
13. **Admin adjustments without audit note** — silent self-dealing.
14. **Not reversing on refund** — free money.
15. **Storing the cookie value as a plain code string** — if the code
    rotates or is revoked, the cookie becomes stale. Store referrer
    id + firstTouchAt.
16. **Signing up via OAuth loses the cookie** — cookie must survive
    the OAuth round-trip; test this path.
17. **No `status=paused`** — when fraud wave hits, operator has no
    kill switch short of deleting the program.
18. **Mixing give-and-get with get-only programs** — confuses users.
19. **Reward email before transaction commit** — "You earned $X" then
    the transaction rolls back; user saw phantom credit.
20. **Fraud model via ML with no explainability** — users dispute;
    operator has no rationale. Rule-based first.
21. **Letting referrer see referee's signup IP** — grossly identifying.
22. **Public referrer-leaderboard** without opt-in — privacy issue.
23. **Sharing the same Stripe promotion code** across all referees —
    fraud ramp; one-time codes per attribution.
24. **No Crockford normalization on input** — user types `O` instead
    of `0`; accept both.
25. **Forgetting tax events for cash rewards** — 1099/DAC7 deadlines
    are not kind.

## References

- ADRs: [0019](../adr/0019-http-client-and-error-model.md),
  [0023](../adr/0023-compliance-audit-log-contract.md),
  [0034](../adr/0034-auth-cookie-and-csrf-contract.md)
- Siblings: [analytics.md](analytics.md), [payments.md](payments.md),
  [billing-tax.md](billing-tax.md), [audit-log.md](audit-log.md),
  [structured-emails.md](structured-emails.md),
  [cookies-authoritative.md](cookies-authoritative.md)
- IRS 1099-MISC threshold: $600/year; EU DAC7 (DAC7 Directive 2021/514)
- Crockford base32: https://www.crockford.com/base32.html
- OWASP cheat sheet — Session Management (cookie attributes)
