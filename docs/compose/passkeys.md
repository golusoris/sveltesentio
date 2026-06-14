# Passkeys — `@simplewebauthn/browser` + Golusoris `go-webauthn`

`@sveltesentio/auth/webauthn` wraps `@simplewebauthn/browser@^13.3` —
the browser-side WebAuthn ceremony helper that pairs 1:1 with
Golusoris's `go-webauthn` server. No hand-rolled base64url. No
ArrayBuffer marshalling in app code.

See [ADR-0033](../adr/0033-simplewebauthn-passkeys.md) for the decision.
Related: [auth-oidc.md](auth-oidc.md) (session lifecycle — passkeys are
a factor, not a session replacement),
[ADR-0036](../adr/0036-mfa-ui-structured-errors.md) (structured MFA
errors).

## What passkeys are (in 60s)

A passkey is a public/private keypair bound to an origin + user. The
private key never leaves the authenticator (Touch ID, Windows Hello,
YubiKey, Android credential store). On login the server sends a
challenge, the authenticator signs it, the server verifies against the
registered public key. No shared secret, nothing to phish.

Two ceremonies:

- **Registration** — enroll a new passkey against a logged-in user.
- **Authentication** — sign in with an enrolled passkey.

Both follow the same request/response pattern: `POST /begin` returns
options; browser invokes `navigator.credentials.*`; client posts the
result to `/finish`.

## Install

```bash
pnpm add @sveltesentio/auth @simplewebauthn/browser
```

Peer range: `@simplewebauthn/browser@^13.3`. Server side runs
`go-webauthn` on Golusoris — ceremony JSON shapes are identical.

## Architecture

```text
┌──────────┐    begin       ┌──────────────┐    begin    ┌──────────────┐
│ Browser  │────────────▶   │  SvelteKit   │────────────▶│  Golusoris   │
│          │◀── options ────│    relay     │◀── options ─│ go-webauthn  │
└──────────┘                 └──────────────┘              └──────────────┘
      │
      │ navigator.credentials.{create,get}()
      ▼
┌──────────┐    finish      ┌──────────────┐    finish   ┌──────────────┐
│ Browser  │────────────▶   │  SvelteKit   │────────────▶│  Golusoris   │
│          │◀── result ─────│    relay     │◀── result ──│ go-webauthn  │
└──────────┘                 └──────────────┘              └──────────────┘
```

SvelteKit is a pass-through — no ceremony state lives in the SvelteKit
process. Golusoris stores the per-user challenge + registered credentials.

## Feature detection

Passkeys require `PublicKeyCredential` + conditional-UI support. Always
feature-detect before showing a passkey affordance.

```ts
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';

if (browserSupportsWebAuthn()) {
  showPasskeyButton();
}
```

For conditional-UI autofill (login forms that suggest passkeys inline):

```ts
import { browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';

if (await browserSupportsWebAuthnAutofill()) {
  // autocomplete="username webauthn" on the email field
}
```

## Register a passkey

```svelte
<!-- src/routes/account/security/+page.svelte -->
<script lang="ts">
  import { registerPasskey } from '@sveltesentio/auth/webauthn';
  import { toast } from '@sveltesentio/ui';

  let submitting = $state(false);

  async function enroll() {
    submitting = true;
    try {
      await registerPasskey({ name: 'MacBook Pro — Touch ID' });
      toast.success('Passkey saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      submitting = false;
    }
  }
</script>

<button onclick={enroll} disabled={submitting}>Add passkey</button>
```

`registerPasskey({ name })`:

1. `POST /auth/webauthn/register/begin` → receives `PublicKeyCredentialCreationOptions`.
2. Calls `@simplewebauthn/browser`'s `startRegistration(options)` — browser prompts for authenticator.
3. `POST /auth/webauthn/register/finish` with the attestation result.
4. Returns `{ credentialId, name }` on success; throws `ProblemError` on failure.

Or use the drop-in component:

```svelte
<script lang="ts">
  import { PasskeyRegister } from '@sveltesentio/auth/webauthn';
</script>

<PasskeyRegister onsuccess={(e) => toast.success(`Added ${e.detail.name}`)} />
```

## Authenticate with a passkey

```svelte
<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  import { loginPasskey, browserSupportsWebAuthn } from '@sveltesentio/auth/webauthn';
  import { goto } from '$app/navigation';

  let email = $state('');
  let err = $state<string | null>(null);

  async function signIn() {
    err = null;
    try {
      await loginPasskey({ email });
      await goto('/app');
    } catch (e) {
      err = e instanceof Error ? e.message : 'Sign in failed';
    }
  }
</script>

<form onsubmit={(e) => { e.preventDefault(); signIn(); }}>
  <input
    type="email"
    bind:value={email}
    autocomplete="username webauthn"
    required
  />
  {#if browserSupportsWebAuthn()}
    <button type="submit">Sign in with passkey</button>
  {:else}
    <p>This device doesn't support passkeys. <a href="/auth/start">Use OIDC instead.</a></p>
  {/if}
  {#if err}<p role="alert">{err}</p>{/if}
</form>
```

`loginPasskey({ email })`:

1. `POST /auth/webauthn/login/begin` with the email → receives
   `PublicKeyCredentialRequestOptions`.
2. Calls `startAuthentication(options)` — browser prompts user to
   select + use an enrolled passkey.
3. `POST /auth/webauthn/login/finish` with the assertion.
4. Server mints a session cookie on success (same cookie as OIDC;
   see [auth-oidc.md](auth-oidc.md)).

## Conditional UI (autofill)

Passkeys can appear as autofill suggestions on the username field. The
ceremony runs in the background without a button click:

```ts
import { startAuthentication } from '@simplewebauthn/browser';

onMount(async () => {
  if (!(await browserSupportsWebAuthnAutofill())) return;

  const options = await fetch('/auth/webauthn/login/begin', {
    method: 'POST',
    body: JSON.stringify({ discoverable: true }),
  }).then((r) => r.json());

  const result = await startAuthentication(options, true); // useBrowserAutofill = true
  await fetch('/auth/webauthn/login/finish', {
    method: 'POST',
    body: JSON.stringify(result),
  });
  await goto('/app');
});
```

The `autocomplete="username webauthn"` attribute on the input is
required for the browser to surface passkeys.

## Fallback UX

Always pair the passkey button with the OIDC start path:

```svelte
<PasskeyLogin />
<hr />
<a href="/auth/start">Sign in with another method</a>
```

Passkey UX fails gracefully when:

- The browser doesn't support WebAuthn (older iOS, embedded webviews).
- No passkey is enrolled for the given email.
- The user cancels the authenticator prompt.

Fall through to OIDC in every case.

## Listing and revoking passkeys

Users need a UI to see what's enrolled and revoke a lost device:

```svelte
<script lang="ts">
  import { listPasskeys, revokePasskey } from '@sveltesentio/auth/webauthn';

  let { data } = $props(); // data.passkeys from +page.server.ts

  async function revoke(credentialId: string) {
    await revokePasskey(credentialId);
    await invalidate('app:passkeys');
  }
</script>

<ul>
  {#each data.passkeys as pk (pk.credentialId)}
    <li>
      {pk.name} · added {pk.createdAt.toLocaleDateString()}
      · last used {pk.lastUsedAt?.toLocaleDateString() ?? 'never'}
      <button onclick={() => revoke(pk.credentialId)}>Revoke</button>
    </li>
  {/each}
</ul>
```

## MFA interop

If the server requires passkeys as a second factor, the OIDC flow
returns a `ProblemError` with `type: "urn:golusoris:mfa-required"` and
`factors: ['webauthn']`. The UI presents `<PasskeyLogin>` to satisfy
the factor. See [mfa.md](mfa.md) (pending).

## Testing

Playwright can drive WebAuthn with Chrome DevTools' virtual authenticator:

```ts
import { test } from '@playwright/test';

test('passkey login', async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });

  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Add passkey' }).click();
  // The virtual authenticator auto-consents — no OS prompt.

  // Later: sign in
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await page.waitForURL('/app');
});
```

Unit-test `registerPasskey` / `loginPasskey` with `@sveltesentio/testing`'s
WebAuthn fixture — it stubs `navigator.credentials` + fetch.

## Anti-patterns

- **Rolling base64url / ArrayBuffer marshalling.** `@simplewebauthn/browser`
  handles it. Touching `Uint8Array` in app code is a smell.
- **Putting a passkey button with no fallback.** Hostile to users whose
  browser doesn't support WebAuthn (embedded webviews, older Safari).
  Always pair with OIDC.
- **Storing the attestation blob client-side.** All ceremony state lives
  on Golusoris. The client holds nothing between `/begin` and `/finish`.
- **Conditional UI without `autocomplete="username webauthn"`.** The
  attribute is non-optional — browsers won't surface passkeys otherwise.
- **Registering without a human-readable name.** Users can't revoke a
  lost device they can't identify. Prompt for a name (default to UA
  parser output if unset).
- **Using passkeys as a session replacement.** Passkeys authenticate;
  the session cookie (see [auth-oidc.md](auth-oidc.md)) carries
  authorization. One factor, one session.
- **Hanko / Passlock / Clerk.** ADR-0033 scope — we own auth.

## References

- ADR-0033 — `@simplewebauthn/browser` decision.
- ADR-0036 — MFA structured-error contract.
- [auth-oidc.md](auth-oidc.md) — session lifecycle.
- `@simplewebauthn/browser` docs: <https://simplewebauthn.dev/docs/packages/browser>.
- WebAuthn L3 spec: <https://www.w3.org/TR/webauthn-3/>.
- Golusoris `auth/webauthn/` README — server-side `go-webauthn` contract.
