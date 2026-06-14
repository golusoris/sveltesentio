# RBAC modeling — roles, permissions, conditions, policy evaluation

> Authorization model that scales from two roles to policy-driven
> conditional access, built on
> [permissions.md](permissions.md) (the `usePermissions` rune and
> `load`-derived SvelteKit pattern, [ADR-0035](../adr/0035-permissions-load-derived.md))
> and consumed by [admin-ui-patterns.md](admin-ui-patterns.md),
> [auth-oidc.md](auth-oidc.md), and
> [sso-saml.md](sso-saml.md). Default: role-permission with explicit
> tenant scope; upgrade path to ABAC-style conditions when roles
> can't express the rule. Avoid policy engines ("Cedar", "OPA") until
> the conditional surface genuinely justifies the operational cost.

Authorization is a **ladder**, not a religion. Ship role-based
authorization first; add conditional predicates when a role explosion
starts or when "the marketing team can read X, but only rows where
`tenant_id = user.tenant_id and status = 'published'`" appears.
Ladder steps: `role → role+scope → role+permission → role+permission+
condition → policy engine`. Do not skip to the top.

## Related

- [permissions.md](permissions.md) — `load`-derived permission rune
- [admin-ui-patterns.md](admin-ui-patterns.md) — four-tier admin RBAC
- [audit-log.md](audit-log.md) — role grants/revokes are audited
- [auth-oidc.md](auth-oidc.md) — sources identity
- [sso-saml.md](sso-saml.md) — JIT role recompute from IdP attributes
- [mfa.md](mfa.md) — step-up on elevated roles
- [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md)
  — rollout vs entitlement distinction
- [service-limits.md](service-limits.md) — plan-entitlement is NOT
  authorization
- [ADR-0035](../adr/0035-permissions-load-derived.md) — permission
  model
- [ADR-0036](../adr/0036-mfa-structured-errors.md) — MFA errors

## When to use what — decision tree

```text
Two roles, three permissions, no conditions            → role-only
Many tenants, same roles per tenant                    → role + tenant scope
Roles + a small fixed permission set                   → role → permission map
Same role behaves differently per resource state       → role + condition
Externally-defined policy, audit compliance regime     → policy engine (Cedar / OPA)
Plan differences ("pro gets X")                        → service-limits.md (NOT RBAC)
Time-bounded access                                    → grant with expiresAt, not role
Customer-support delegated access                      → impersonation (admin-ui-patterns.md)
```

## Ladder — five steps

1. **Role-only** — user has a role; role authorizes actions globally.
2. **Role + scope** — user has roles per tenant / project / workspace.
3. **Role + permission** — role expands to a bounded permission set;
   check by permission, not by role name.
4. **Role + permission + condition** — attribute predicates on
   resource (owner, status, tenant) enter the grant.
5. **Policy engine** — Cedar/OPA/Casbin external evaluation with a
   declarative policy language.

Six ladder rules:

1. **Start at step 1.** Most apps finish at step 3.
2. **Only climb when blocked.** Adding a condition is simpler than
   adopting a policy engine.
3. **Never skip.** Skipping to step 5 produces unauditable spaghetti
   because step-3 patterns (roles, permissions) are the vocabulary
   the policy engine still needs.
4. **Collapse if possible.** If you find yourself with 40 roles and
   50 permissions, either the roles map to permissions 1:1 (delete
   the roles) or the permissions should be conditions.
5. **Step 4 is the sweet spot** for SaaS — roles give human
   communication; permissions give grep-ability; conditions handle
   the real-world exceptions.
6. **Step 5 is a platform commitment** — policy authoring, versioning,
   testing, distribution, and decision logging are all new workload.

## Shape — bounded vocabularies

```ts
// src/lib/rbac/model.ts
import { z } from 'zod';

export const Role = z.enum([
  'owner',
  'admin',
  'member',
  'viewer',
  'billing',
  'support',
  'staff',
]);
export type Role = z.infer<typeof Role>;

export const Permission = z.enum([
  // users
  'user.read',
  'user.invite',
  'user.suspend',
  'user.delete',
  // content
  'content.read',
  'content.create',
  'content.update',
  'content.delete',
  'content.publish',
  // billing
  'billing.read',
  'billing.manage',
  // admin (back-office, see admin-ui-patterns.md)
  'admin.read',
  'admin.write',
  'admin.super',
]);
export type Permission = z.infer<typeof Permission>;

export const Scope = z.enum([
  'global',            // only for back-office roles
  'tenant',
  'workspace',
  'project',
]);
export type Scope = z.infer<typeof Scope>;
```

Six vocabulary rules:

1. **Bounded enums for Role + Permission** — no free-form strings in
   grants or checks.
2. **Permission names are `resource.action`** — lexicographically
   group for search and audit filters.
3. **`resource.action` not `verb_resource`** — consistency across the
   codebase beats English prose.
4. **`global` scope is rare** — mostly back-office roles. Every other
   role is tenant-scoped.
5. **Never expose role names in URLs** — leaks tenancy model; use
   opaque role IDs in API surfaces.
6. **Permission diff ships with audit log PR** — adding a permission
   is an audit-vocabulary change; treat it like a schema migration.

## Role → permission mapping

```ts
// src/lib/rbac/mapping.ts
import type { Role, Permission } from './model';

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [
    'user.read', 'user.invite', 'user.suspend', 'user.delete',
    'content.read', 'content.create', 'content.update', 'content.delete', 'content.publish',
    'billing.read', 'billing.manage',
  ],
  admin: [
    'user.read', 'user.invite', 'user.suspend',
    'content.read', 'content.create', 'content.update', 'content.delete', 'content.publish',
    'billing.read',
  ],
  member: [
    'user.read',
    'content.read', 'content.create', 'content.update',
  ],
  viewer: ['user.read', 'content.read'],
  billing: ['user.read', 'billing.read', 'billing.manage'],
  support: ['user.read', 'content.read'],
  staff: ['admin.read'],
} as const;

export function rolePermissions(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
```

Six mapping rules:

1. **Single authoritative map**, code-checked at compile time.
2. **No inheritance trees** — `admin` is not "owner minus X". It
   lists its own permissions. Inheritance trees obscure diffs.
3. **Bounded arrays** — TypeScript `readonly` so refactor tools catch
   additions across the codebase.
4. **Additive changes only** between releases. Removing a permission
   from a role is a migration (audit impact).
5. **Grants are role-level**; enforcement is permission-level. User
   sees "admin"; code checks `user.permissions.has('content.publish')`.
6. **Back-office roles (`staff`, `admin:*` tiers) live in a
   separate map** — see [admin-ui-patterns.md](admin-ui-patterns.md).

## Grant — user ↔ role ↔ scope

```ts
// src/lib/rbac/grants.ts
import { z } from 'zod';
import { Role, Scope } from './model';

export const Grant = z.object({
  userId: z.string().uuid(),
  role: Role,
  scope: Scope,
  scopeId: z.string().min(1),       // tenant/workspace/project id
  grantedAt: z.string().datetime(),
  grantedBy: z.string().uuid(),
  expiresAt: z.string().datetime().nullable(),
  reason: z.string().min(4),
});
export type Grant = z.infer<typeof Grant>;
```

Seven grant rules:

1. **Every grant has a `grantedBy`** — self-grants only via
   break-glass + audit.
2. **`expiresAt` nullable** but required for `staff`/`admin:super`-
   style elevated roles.
3. **`reason` is required** — audit value scales with reason quality.
4. **One row per (user, role, scope, scopeId)** — unique constraint.
5. **Grant changes are audited** via [audit-log.md](audit-log.md) on
   INSERT/UPDATE/DELETE triggers.
6. **Soft-delete (tombstone)** grants on revoke; hard-delete only
   after retention period.
7. **Tenant admins can grant only within their tenant** — the
   enforcement is a permission (`user.grant`) scoped to tenant.

## Evaluation — the authorization function

```ts
// src/lib/rbac/evaluate.ts
import type { Permission } from './model';
import { rolePermissions } from './mapping';
import { evaluateCondition, type Conditions } from './conditions';

export type AuthContext = {
  user: { id: string; grants: Grant[]; mfaAgeSec: number };
  permission: Permission;
  resource: { tenantId: string; ownerId?: string; status?: string };
  now: Date;
};

export type AuthDecision =
  | { allow: true }
  | { allow: false; reason: 'no_grant' | 'scope_mismatch' | 'condition_failed' | 'mfa_required' | 'expired' };

export function authorize(ctx: AuthContext): AuthDecision {
  const applicable = ctx.user.grants.filter((g) =>
    g.scope === 'tenant' && g.scopeId === ctx.resource.tenantId,
  );
  if (applicable.length === 0) return { allow: false, reason: 'scope_mismatch' };

  for (const grant of applicable) {
    if (grant.expiresAt && new Date(grant.expiresAt) < ctx.now) continue;
    const perms = rolePermissions(grant.role);
    if (!perms.includes(ctx.permission)) continue;
    const cond = conditionFor(grant.role, ctx.permission);
    if (cond && !evaluateCondition(cond, ctx)) continue;
    if (requiresMfa(ctx.permission) && ctx.user.mfaAgeSec > 300) {
      return { allow: false, reason: 'mfa_required' };
    }
    return { allow: true };
  }
  return { allow: false, reason: 'no_grant' };
}
```

Seven evaluation rules:

1. **One pure function** — `authorize(ctx)` has no IO; preload
   `user.grants` in the `load` function per
   [permissions.md](permissions.md).
2. **Decisions are explicit enums** — `allow: false, reason: ...`
   feeds UI messaging + audit.
3. **Scope mismatch returns first** — cheapest check, most common
   rejection.
4. **Expired grants skip silently** — they are legitimate "no-op"
   cases.
5. **MFA freshness check** for elevated permissions — 5-minute
   default per [admin-ui-patterns.md](admin-ui-patterns.md).
6. **Early exit on success** — do not evaluate further grants.
7. **No exceptions for authorization failures** — returning a
   decision object beats throwing, because callers need the reason
   for error envelope shaping per RFC 9457.

## Conditions (step 4 — ABAC slice)

```ts
// src/lib/rbac/conditions.ts
export type Condition =
  | { type: 'owner'; field: 'ownerId' }
  | { type: 'status_in'; values: readonly string[] }
  | { type: 'tenant_tier_in'; tiers: readonly string[] }
  | { type: 'time_window'; fromUtcHour: number; toUtcHour: number };

export function evaluateCondition(cond: Condition, ctx: AuthContext): boolean {
  switch (cond.type) {
    case 'owner':
      return ctx.resource.ownerId === ctx.user.id;
    case 'status_in':
      return !!ctx.resource.status && cond.values.includes(ctx.resource.status);
    case 'tenant_tier_in':
      return cond.tiers.includes(ctx.user.tenantTier);
    case 'time_window': {
      const h = ctx.now.getUTCHours();
      return h >= cond.fromUtcHour && h < cond.toUtcHour;
    }
  }
}
```

Six condition rules:

1. **Discriminated union** — pattern-match exhaustively. Adding a
   condition type forces every evaluator to handle it.
2. **Pure predicates** — no network, no DB. All inputs come from the
   `ctx`.
3. **Small vocabulary** — 4–8 condition types cover 99 % of SaaS
   rules. A dozen is a smell; you might need step 5.
4. **Test conditions independently** — each has property tests.
5. **Never embed SQL or raw JS in the condition spec** — that's
   step-5 territory.
6. **Conditions are per-(role, permission)** — not a global "catch
   all" condition list; bind them to the exact grant context.

## Policy engine (step 5 — only if forced)

When to adopt:

- Compliance regime mandates a formal policy language with attestable
  evaluator (SOC 2 with external auditor request).
- Conditional surface exceeds ~12 predicates with cross-cutting rules
  that change per tenant.
- Policies must be authored by non-engineers (security / compliance
  team) with a review flow.

Default options:

- **Cedar** — AWS open-source, modern, strong typing + test harness.
- **Open Policy Agent (OPA)** — proven, Rego-based, mature tooling.
- **Casbin** — simpler, good for classical ACL/RBAC/ABAC mix.

Seven policy-engine rules:

1. **Keep roles + permissions** — the engine evaluates against the
   same vocabulary; do not re-invent.
2. **Decision logs go to a separate sink** — append-only audit with
   policy version + decision reason.
3. **Policy versions are code-reviewed** PRs, not dashboard edits.
4. **Distribute via OCI artifact or signed bundle** — not a bare
   fetch; supply-chain risk.
5. **Evaluate at the server boundary** — never trust client-side
   policy eval.
6. **Fallback decision** on evaluator failure is `deny` (fail-closed).
7. **Test harness first** — ship a test suite alongside policies;
   policies without tests are aspirational.

## Client-side surfacing

Three client rules:

1. **Preload decisions in `load`** — the rune surfaces the resolved
   permission list (per
   [permissions.md](permissions.md)), not raw grants.
2. **UI gating hides vs disables** — gate destructive actions with
   hidden (reduce attack surface); gate normal actions with disabled
   + tooltip (discoverability).
3. **Client is hint, server is truth** — every action is re-checked
   server-side; client check is UX only.

```svelte
<script lang="ts">
  import { usePermissions } from '$lib/rbac/client';
  const perms = usePermissions();
  const canPublish = $derived(perms.has('content.publish'));
</script>

{#if canPublish}
  <button onclick={publish}>Publish</button>
{:else}
  <button disabled title="Your role cannot publish content">Publish</button>
{/if}
```

## Impersonation interaction

Six impersonation rules:

1. **Impersonation does not inherit permissions** — the impersonator's
   permissions are intersected with the target's.
2. **Read-only impersonation clamps write permissions off** at the
   grant layer, not just UI.
3. **Audit records both actor identities** — impersonator + target.
4. **Step-4 conditions see the impersonator's attributes**, not the
   target's, for compliance (time_window, IP allow-list).
5. **`admin:super` cannot be impersonated** — the elevated surface is
   locked to the original identity.
6. See [admin-ui-patterns.md](admin-ui-patterns.md) for the full
   impersonation flow.

## SSO + JIT sync

Five SSO rules:

1. **Roles recompute every login** from the IdP's attribute mapping —
   never trust cached roles across sessions.
2. **IdP group → role map** is the boundary — a stable, bounded
   mapping table per tenant, code-reviewed.
3. **Unknown IdP groups produce `viewer`** or explicit deny — never
   default to `admin`.
4. **Attribute additions are additive** — removing an IdP group must
   revoke the role on next login.
5. **SCIM deprovisioning** revokes all grants immediately, not on
   next login, per [sso-saml.md](sso-saml.md).

## Testing

Six test lanes:

1. **Unit** — `authorize(ctx)` with a matrix of `(role, permission,
   scope, condition)` tuples.
2. **Property-based** — all permissions either allow or deny with a
   reason; no throw.
3. **Grant lifecycle** — grant, expire, revoke, re-grant.
4. **Condition combinations** — owner + status_in together evaluate
   independently.
5. **Regression** — a fixture per historical incident ensures the
   rule that caused the bug stays in place.
6. **Fuzz the mapping** — for each role, the mapped permissions must
   be a subset of the bounded `Permission` enum.

## Observability

Bounded labels:

- `authz.permission` — bounded enum
- `authz.role` — bounded enum
- `authz.decision` — `allow|deny`
- `authz.deny_reason` — bounded enum (`no_grant|scope_mismatch|
  condition_failed|mfa_required|expired`)
- `authz.scope` — `global|tenant|workspace|project`

Gauges + alerts:

- `authz.deny_rate_by_permission` — a sudden shift indicates a change
  in grant distribution or a bug.
- `authz.eval_latency_p95_ms` — stays under 1 ms for step 1–4; tens
  of ms acceptable for step 5.
- `authz.grants.active_per_role` gauge — watch for role inflation.
- Alert on `deny_reason == 'mfa_required'` rate >0.1 %/min — a flow
  is missing the step-up prompt.

## Anti-patterns

1. **Checking `user.role === 'admin'`** in code — bypasses the
   permission map + conditions. Always check a permission.
2. **Per-user permission overrides** — "this one user can publish"
   creates auditable drift; use a new role.
3. **Role inheritance trees** — `adminExtended extends admin extends
   member` — unauditable diffs, fragile on refactor.
4. **Plan entitlements modeled as roles** — "pro", "free" are plans;
   see [service-limits.md](service-limits.md).
5. **Time-bounded access via "temp role"** — use a grant with
   `expiresAt`, not a role-per-duration.
6. **Free-form condition strings** parsed at runtime — injection
   surface; keep conditions as a discriminated union.
7. **Client-only enforcement** — any `+server.ts` handler must
   re-evaluate.
8. **Returning 404 for `deny_reason == 'no_grant'`** on a resource
   the user can read — inconsistent error surface confuses support.
9. **Returning 403 on `deny_reason == 'mfa_required'`** — the right
   response is a step-up challenge with RFC 9457 `mfa_required`
   (per [mfa.md](mfa.md)).
10. **Adopting a policy engine on day one** — premature platform
    commitment.
11. **No test suite for policies** — policies without tests rot
    under tenant-specific exceptions.
12. **Caching grants for hours** — revokes should take effect within
    a minute; cache ≤60 s.
13. **Role rename across a release** — invalidates audit history;
    add a new role + migrate grants over the deprecation window.
14. **MFA freshness window = session lifetime** — defeats the point;
    5–15 minutes for elevated actions.
15. **Impersonation that elevates** — target has perm X, impersonator
    doesn't, so impersonation grants it; this is privilege escalation.
16. **SSO mapping defaults to `admin`** on unknown group — a typo in
    the IdP config elevates everyone.
17. **Grants without `grantedBy`** — cannot reconstruct the decision
    trail.
18. **Permission names in URLs** — leaks model; prefer ID-based
    surfaces.
19. **Cross-tenant super-role** that implicitly grants access — any
    cross-tenant permission is an explicit, audited `global`
    scope grant.
20. **Silent condition failures** — evaluator must report
    `condition_failed` so UI + audit can explain the denial.

## References

- [ADR-0035 — permissions `load`-derived](../adr/0035-permissions-load-derived.md)
- [ADR-0036 — MFA structured errors](../adr/0036-mfa-structured-errors.md)
- [permissions.md](permissions.md) / [admin-ui-patterns.md](admin-ui-patterns.md) / [audit-log.md](audit-log.md) / [auth-oidc.md](auth-oidc.md) / [sso-saml.md](sso-saml.md) / [mfa.md](mfa.md) / [feature-flag-rollout-patterns.md](feature-flag-rollout-patterns.md) / [service-limits.md](service-limits.md)
- [Cedar policy language](https://www.cedarpolicy.com/)
- [Open Policy Agent](https://www.openpolicyagent.org/)
- [NIST RBAC Model (INCITS 359-2012)](https://csrc.nist.gov/projects/role-based-access-control)
- [OWASP ASVS L2 §V4 — access control](https://owasp.org/www-project-application-security-verification-standard/)
