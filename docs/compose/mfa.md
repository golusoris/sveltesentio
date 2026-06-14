# MFA — structured `ProblemError` codes + `<MfaChallenge>` / `<MfaEnroll>`

Multi-factor authentication flows through **structured RFC 9457
error codes**, never substring-matching on error messages. Golusoris
emits `type: "urn:golusoris:auth:mfa_required"` on a protected
request; `@sveltesentio/auth` ships `<MfaChallenge>` and `<MfaEnroll>`
that consume the typed error directly. A single `handleAuthError()`
helper narrows the `ProblemError` via exhaustive switch — no regex,
no i18n fragility.

See [ADR-0036](../adr/0036-mfa-ui-structured-errors.md) for the
decision. Related: [ADR-0019](../adr/0019-openapi-fetch-rfc9457.md)
(RFC 9457 pipeline), [auth-oidc.md](auth-oidc.md) (session lifecycle),
[passkeys.md](passkeys.md) (WebAuthn as an MFA factor).

## Error code contract

Golusoris emits three typed errors for MFA:

| Type | Status | Meaning |
|---|---|---|
| `urn:golusoris:auth:mfa_required` | 401 | MFA challenge needed before this request proceeds |
| `urn:golusoris:auth:mfa_invalid` | 401 | Submitted code / assertion was wrong |
| `urn:golusoris:auth:mfa_rate_limited` | 429 | Too many failed attempts; back off |

Each error carries `extensions` per RFC 9457:

```ts
type MfaRequiredExtensions = {
  challengeId: string;                    // short-lived opaque token
  allowedMethods: Array<'totp' | 'webauthn' | 'recovery'>;
  expiresAt: string;                      // ISO 8601
};

type MfaRateLimitedExtensions = {
  retryAfter: number;                     // seconds
};
```

The `challengeId` scopes the retry — every submit ties back to the
same pending challenge so replay attacks fail server-side.

## Install

```bash
pnpm add @sveltesentio/auth
```

## Narrow the error

```ts
// src/lib/auth.ts
import { handleAuthError, type AuthErrorState } from '@sveltesentio/auth';
import type { ProblemError } from '@sveltesentio/core/http';

export async function doProtectedAction() {
  try {
    await api.POST('/thing', { body });
  } catch (err) {
    const state = handleAuthError(err);
    switch (state.kind) {
      case 'mfa_required':
        openMfaChallenge(state.challengeId, state.allowedMethods);
        return;
      case 'mfa_rate_limited':
        toast.error(`Too many attempts. Try again in ${state.retryAfter}s.`);
        return;
      case 'unauthenticated':
        await goto('/auth/start');
        return;
      case 'other':
        throw state.error; // re-throw for the generic error boundary
    }
  }
}
```

`handleAuthError(err)` accepts any thrown value. It returns an
`AuthErrorState` discriminated union — the switch is exhaustive by
type. If Golusoris adds a new code, TypeScript fails the compile until
the switch handles it.

Never do:

```ts
// DON'T — substring match on error.message
if (err.message.includes('mfa')) { /* … */ }

// DON'T — status-code match
if (err.status === 401) { /* assume MFA */ }
```

A server-side i18n change silently breaks substring matching. A 401
without a type code could also mean "session expired" — different UX.

## Challenge component

```svelte
<!-- src/routes/app/+layout.svelte -->
<script lang="ts">
  import { MfaChallenge } from '@sveltesentio/auth';
  import { mfaState } from '$lib/mfaStore.svelte';
</script>

{@render children()}

{#if mfaState.current}
  <MfaChallenge
    challengeId={mfaState.current.challengeId}
    allowedMethods={mfaState.current.allowedMethods}
    onsuccess={() => mfaState.clear()}
    oncancel={() => mfaState.clear()}
  />
{/if}
```

```ts
// src/lib/mfaStore.svelte.ts
import type { AuthErrorState } from '@sveltesentio/auth';

export const mfaState = {
  current: $state<{
    challengeId: string;
    allowedMethods: Array<'totp' | 'webauthn' | 'recovery'>;
  } | null>(null),

  open(state: Extract<AuthErrorState, { kind: 'mfa_required' }>) {
    this.current = {
      challengeId: state.challengeId,
      allowedMethods: state.allowedMethods,
    };
  },

  clear() { this.current = null; },
};
```

`<MfaChallenge>`:

- Renders a method picker when `allowedMethods.length > 1` (TOTP,
  passkey, recovery code).
- Focuses the input / passkey prompt automatically.
- Submits to `POST /auth/mfa/verify` with
  `{ challengeId, method, payload }`.
- Calls `onsuccess` when Golusoris returns 200 (and the pending request
  should be re-submitted by the caller via the stored intent).
- Shows inline error on `mfa_invalid`; disables submit + shows countdown
  on `mfa_rate_limited`.
- Auto-closes on `expiresAt` with a "Session expired, sign in again"
  prompt.

## Retrying the original request

MFA interrupts a user action. After `onsuccess`, the caller re-submits:

```ts
// src/lib/auth.ts
import { retryWithMfa } from '@sveltesentio/auth';

export async function doProtectedActionWithRetry() {
  return retryWithMfa(async () => {
    return api.POST('/thing', { body });
  });
}
```

`retryWithMfa(fn)`:

1. Runs `fn`.
2. On `mfa_required`, opens the challenge via `mfaState.open()`.
3. Awaits `onsuccess` (or rejects on `oncancel`).
4. Re-runs `fn`. One retry max — a second `mfa_required` throws.

Callers get a single `Promise` that resolves after the challenge
completes. No intent storage, no route reload.

## Enrollment

```svelte
<!-- src/routes/account/security/+page.svelte -->
<script lang="ts">
  import { MfaEnroll } from '@sveltesentio/auth';
  import { toast } from '@sveltesentio/ui/toast';
</script>

<section>
  <h2>Two-factor authentication</h2>
  <MfaEnroll
    methods={['totp', 'webauthn']}
    onsuccess={(e) => toast.success(`Added ${e.detail.method}`)}
  />
</section>
```

`<MfaEnroll>`:

- Presents a tab per method (`totp`, `webauthn`, `recovery`).
- TOTP tab renders QR code + manual key, confirms by first code.
- WebAuthn tab delegates to `@simplewebauthn/browser` (see
  [passkeys.md](passkeys.md)).
- Recovery tab generates 10 single-use codes and requires user to
  download/print them before closing.
- All tabs write via Golusoris `POST /auth/mfa/enroll/{method}`.

Each method is independent — users can enroll TOTP *and* a passkey.
Recovery codes are mandatory once any method is enrolled.

## Recovery codes

Recovery is a fallback-only factor. The UI downplays it:

```svelte
<details>
  <summary class="text-muted-fg text-sm">Lost your device? Use a recovery code.</summary>
  <!-- form scoped to method=recovery -->
</details>
```

Never auto-focus the recovery input; the primary method (TOTP/WebAuthn)
gets focus by default. Recovery codes are single-use — Golusoris
invalidates the code on consumption.

## i18n

All component copy flows through Paraglide (see
[ADR-0017](../adr/0017-paraglide-v2-i18n-default.md)). Keys are
stable — safe for substring-match-free logic:

| Key | English |
|---|---|
| `mfa.challenge.title` | Two-factor authentication |
| `mfa.challenge.totp.label` | Authenticator code |
| `mfa.challenge.webauthn.prompt` | Use your passkey |
| `mfa.challenge.recovery.prompt` | Enter a recovery code |
| `mfa.enroll.totp.confirm` | Enter the 6-digit code to confirm |
| `mfa.error.invalid` | That code didn't match. Try again. |
| `mfa.error.rate_limited` | Too many attempts. Try again in {seconds}s. |

Override via app-level Paraglide catalogue.

## Accessibility

- Challenge dialog uses `role="dialog"` + `aria-modal="true"` + focus
  trap.
- Input announces `aria-invalid="true"` on error; error message is
  linked via `aria-describedby`.
- Rate-limit countdown uses `aria-live="polite"`.
- Method picker is a radio group (`role="radiogroup"`) — arrow keys
  navigate, `Enter` picks.

## Testing

Mock `handleAuthError` in unit tests; Playwright for the full flow:

```ts
test('mfa challenge after protected action', async ({ page }) => {
  await signIn(page); // pre-seeded session
  await page.goto('/account/delete');
  await page.getByRole('button', { name: /delete account/i }).click();

  const dialog = page.getByRole('dialog', { name: /two-factor/i });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/authenticator code/i).fill('123456');
  await dialog.getByRole('button', { name: /verify/i }).click();

  await expect(dialog).toBeHidden();
  // Original delete retried — page should be at /goodbye
  await page.waitForURL('/goodbye');
});
```

`@sveltesentio/testing` ships an `mfaFixture` that stubs the Golusoris
responses with valid/invalid/rate-limited branches.

## Migration — replace substring match

Legacy pattern (from revenge):

```ts
// DON'T
if (error.message.includes('mfa') || error.message.includes('2fa')) {
  showMfaDialog();
}
```

Replacement:

```ts
import { handleAuthError } from '@sveltesentio/auth';
const state = handleAuthError(error);
if (state.kind === 'mfa_required') {
  mfaState.open(state);
}
```

Golusoris already emits the typed codes — the only change is on the
client. Once migrated, delete the substring strings entirely (don't
leave them as "fallback" — a stale string match is worse than none).

## Anti-patterns

- **Substring matching on error messages.** ADR-0036's dispositive
  rejection. i18n-fragile; status-code ambiguous.
- **Assuming 401 = MFA required.** 401 without a type code means
  unauthenticated. Use `handleAuthError` to disambiguate.
- **Storing the MFA intent in `localStorage`.** `retryWithMfa` keeps
  it in memory — the intent doesn't survive a reload, and it shouldn't
  (user decisions about sensitive actions don't resume).
- **Auto-submitting TOTP on 6th digit without confirmation.** Accessible
  to screen readers via the Submit button; auto-submit races keyboard
  users. Require explicit submit.
- **Rolling a custom QR in `<MfaEnroll>`.** The component embeds the
  canonical QR library (`qrcode`). Don't replace — Golusoris's secret
  URI format is version-locked.
- **Showing recovery codes in a toast.** Codes must be explicitly
  downloaded/printed. A toast that disappears in 4s loses them.
- **Third-party MFA SaaS (Auth0 MFA, etc.).** Duplicates Golusoris.
  Hard no (ADR-0036).

## References

- ADR-0036 — MFA structured-errors decision + revenge substring-match
  antipattern.
- ADR-0019 — RFC 9457 error pipeline.
- ADR-0017 — Paraglide v2 i18n.
- [auth-oidc.md](auth-oidc.md) — session lifecycle.
- [passkeys.md](passkeys.md) — WebAuthn as a factor.
- RFC 9457 — <https://datatracker.ietf.org/doc/html/rfc9457>.
