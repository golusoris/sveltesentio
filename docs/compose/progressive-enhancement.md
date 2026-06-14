# progressive-enhancement.md — composition recipe

> **Forms and navigation that work without JavaScript.** SvelteKit's
> form actions + `use:enhance` + native `<a>` + `<form>` compose into
> a stack that submits, navigates, and handles errors **before** any
> client JS loads — then progressively enhances once hydration runs.
> Per [ADR-0019](../adr/0019-http-client-and-error-model.md) every
> mutating endpoint returns `application/problem+json` and every
> 303-redirect is a legitimate navigation target. Per
> [ADR-0003](../adr/0003-forms-superforms.md) Superforms is the
> default form surface, and `SuperDebug` aside, it is designed to
> submit with or without JS.

> **The baseline contract.** Curl the page → it works. Disable JS in
> devtools → it still works. Chromium on cheap Android with JS
> delayed by 8 seconds on a slow CPU → it works in the meantime.
> "Progressive enhancement" here is not a philosophy; it's a
> measurable CI gate.

## Related

- [forms.md](forms.md) — Superforms v2 is the default form surface;
  `use:enhance` only adds client polish on top of working server
  actions
- [error-boundaries.md](error-boundaries.md) — `+error.svelte` renders
  even without JS; ProblemError mapping preserves status codes
- [http-client.md](http-client.md) — JSON APIs use `openapi-fetch`
  (JS-only); form actions are the no-JS counterpart for mutations
- [csrf-double-submit.md](csrf-double-submit.md) — form actions pick
  up the CSRF token via a hidden field; `use:enhance` keeps the
  header-based path
- [auth-oidc.md](auth-oidc.md) — login, logout, signup all ship as
  form actions first; the button-with-fetch path is the enhancement
- [i18n-runtime-strategy.md](i18n-runtime-strategy.md) — Paraglide
  runs server-side so no-JS pages are already localized
- [image-optimization.md](image-optimization.md) — responsive `<img
  srcset>` is progressive enhancement for bandwidth, not JS
- [pwa.md](pwa.md) — service worker augments the stack; the
  underlying site must work without the SW
- [a11y-audit-runbook.md](a11y-audit-runbook.md) — no-JS mode is the
  strictest a11y baseline
- [ADR-0019](../adr/0019-http-client-and-error-model.md),
  [ADR-0003](../adr/0003-forms-superforms.md)

## When to use what

```text
Login / signup / logout                           → form action (must work without JS)
                                                    use:enhance for no-navigation UX
Checkout flow                                     → form action + redirect on success
                                                    never a button-triggered fetch
Account settings mutations                        → form action
                                                    optimistic UI via use:enhance optional
Delete / destructive action                       → form action with POST + confirmation
                                                    never a GET; never a client-only modal
Filter / search form                              → form action with GET + server render
                                                    client-side filter is enhancement
Infinite scroll / pagination                      → page numbers with real <a> links
                                                    IntersectionObserver is enhancement
Autocomplete / combobox                           → <datalist> baseline
                                                    custom combobox is enhancement
Modal / dialog                                    → linked page baseline (/settings)
                                                    <dialog> open via fetch is enhancement
Drag-and-drop reorder                             → up/down buttons as baseline
                                                    DnD is enhancement
Real-time chat / presence                         → NOT progressive — requires JS
                                                    degrade gracefully with "Enable JS" notice
Charts / graphs                                   → static image or table baseline
                                                    interactive chart is enhancement
Rich text editor                                  → <textarea> with markdown baseline
                                                    WYSIWYG is enhancement
File upload single                                → <input type=file> + form post
                                                    progress bar is enhancement
File upload resumable                             → chunked upload, requires JS
                                                    declare it requires JS, graceful fallback
```

## The four layers

```text
Layer 0: HTML that works                → <form action="..." method="POST">
                                          <a href="...">
                                          browser handles submit + nav
Layer 1: CSS for layout + feedback      → :focus-visible, :invalid, :disabled
                                          aria-busy via checkbox hack if needed
Layer 2: Progressive JS (use:enhance)   → client-side nav without full page reload
                                          optimistic UI, inline error display
Layer 3: Real-time / client-only        → SSE, WebSocket, IndexedDB
                                          declared "requires JS", graceful notice
```

Layers 0–1 are the **floor**. Layer 2 is the default enhancement.
Layer 3 is the explicit opt-out with a visible notice.

## Install

SvelteKit + Superforms (already in stack). No additional dependencies.

## Shape — bounded Zod at the action boundary

```ts
// src/routes/account/update/schema.ts
import { z } from 'zod';

export const UpdateProfile = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(320),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  marketingOptIn: z.coerce.boolean(),
});
export type UpdateProfile = z.infer<typeof UpdateProfile>;
```

`z.coerce.boolean()` is the no-JS path: `<input type="checkbox"
name="marketingOptIn">` either sends `on` (coerced to true) or omits
the field (coerced to false) — native browser behavior.

## Reference pattern

### 1. Form action that works without JS

```ts
// src/routes/account/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';
import { UpdateProfile } from './schema';
import { updateUserProfile } from '$lib/server/users';

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, '/login?next=/account');
  const form = await superValidate(locals.user, zod(UpdateProfile));
  return { form };
}

export const actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, '/login');
    const form = await superValidate(request, zod(UpdateProfile));
    if (!form.valid) return fail(400, { form });
    try {
      await updateUserProfile(locals.user.id, form.data);
    } catch (e) {
      if (e instanceof Error && e.message === 'email_taken') {
        return message(form, { kind: 'error', text: 'Email already in use' }, { status: 409 });
      }
      throw e;
    }
    throw redirect(303, '/account?updated=1');
  },
};
```

Key decisions:
- **Redirect on success (303)** — browser navigates; no JS required to
  show the updated page. With `use:enhance` the navigation is
  intercepted and the destination is loaded via `invalidate`.
- **Return `fail(400)` on validation errors** — browser renders the
  returned page with the form state. With `use:enhance` the same
  state appears inline without a full reload.
- **`message()` helper** — surfaces toast-friendly feedback that also
  renders as static text when JS is off.

### 2. The Svelte page — enhancement is opt-in, not required

```svelte
<!-- src/routes/account/+page.svelte -->
<script lang="ts">
  import { superForm } from 'sveltekit-superforms/client';
  import { zod } from 'sveltekit-superforms/adapters';
  import { UpdateProfile } from './schema';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const { form, errors, enhance, message, submitting } = superForm(data.form, {
    validators: zod(UpdateProfile),
    taintedMessage: 'You have unsaved changes. Leave anyway?',
  });
</script>

<h1>Account settings</h1>

{#if $message}
  <aside role="status" aria-live="polite" class="msg msg-{$message.kind}">
    {$message.text}
  </aside>
{/if}

<form method="POST" action="?/default" use:enhance>
  <label>
    Name
    <input name="name" type="text" bind:value={$form.name} required maxlength="120" aria-invalid={$errors.name ? 'true' : undefined} />
    {#if $errors.name}<span class="err">{$errors.name}</span>{/if}
  </label>

  <label>
    Email
    <input name="email" type="email" bind:value={$form.email} required maxlength="320" />
    {#if $errors.email}<span class="err">{$errors.email}</span>{/if}
  </label>

  <label>
    Language
    <select name="locale" bind:value={$form.locale}>
      <option value="en">English</option>
      <option value="de">Deutsch</option>
      <option value="fr">Français</option>
    </select>
  </label>

  <label>
    <input name="marketingOptIn" type="checkbox" bind:checked={$form.marketingOptIn} />
    Send me product updates
  </label>

  <button type="submit" disabled={$submitting} aria-busy={$submitting}>
    {$submitting ? 'Saving…' : 'Save'}
  </button>
</form>
```

**`use:enhance` without arguments = the good default.** It:
- Prevents the full navigation.
- Handles the response (`fail`, `redirect`, `success`).
- Updates the form state.
- If you remove `use:enhance` entirely, the page still works — just
  with full reloads.

Test both modes: with JS and with `chrome://settings/content/javascript`
blocked for the origin.

### 3. Login without JS

```ts
// src/routes/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { superValidate } from 'sveltekit-superforms/server';
import { zod } from 'sveltekit-superforms/adapters';

const Login = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().max(500).optional(),
});

export async function load({ locals, url }) {
  if (locals.user) throw redirect(303, url.searchParams.get('next') ?? '/');
  const form = await superValidate(zod(Login));
  return { form, next: url.searchParams.get('next') };
}

export const actions = {
  default: async ({ request, locals, cookies }) => {
    const form = await superValidate(request, zod(Login));
    if (!form.valid) return fail(400, { form });
    const session = await authenticate(form.data.email, form.data.password);
    if (!session) return fail(401, { form, bad: true });
    cookies.set('__Host-session', session.token, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 7,
    });
    throw redirect(303, form.data.next ?? '/');
  },
};
```

```svelte
<!-- src/routes/login/+page.svelte -->
<form method="POST" use:enhance>
  <input type="hidden" name="next" value={data.next ?? ''} />
  <label>Email<input name="email" type="email" required autocomplete="email" /></label>
  <label>Password<input name="password" type="password" required autocomplete="current-password" /></label>
  <button>Sign in</button>
</form>
```

This form works curl-ed. It works with JS blocked. It works on the
first paint before any hydration. That is the point.

### 4. Pagination with real anchors

```svelte
<!-- src/routes/posts/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<ul>
  {#each data.posts as post}
    <li><a href="/posts/{post.slug}">{post.title}</a></li>
  {/each}
</ul>

<nav aria-label="Pagination">
  {#if data.prevPage}
    <a href="?page={data.prevPage}" rel="prev">Previous</a>
  {/if}
  {#if data.nextPage}
    <a href="?page={data.nextPage}" rel="next">Next</a>
  {/if}
</nav>
```

```ts
// src/routes/posts/+page.server.ts
export async function load({ url }) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const { posts, total } = await fetchPosts({ page, pageSize: 20 });
  return {
    posts,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: page * 20 < total ? page + 1 : null,
  };
}
```

Infinite scroll via `IntersectionObserver` is **layered on top** of
this — if JS runs, the component replaces "Next" with an auto-load
behavior. If JS is off, the link still works.

### 5. Destructive action — POST with confirmation

```svelte
<!-- src/routes/account/delete/+page.svelte -->
<form method="POST" action="?/delete" use:enhance>
  <p>This will permanently delete your account after 30 days.</p>
  <label>
    Type <strong>DELETE</strong> to confirm
    <input name="confirm" required pattern="DELETE" />
  </label>
  <button class="btn-danger">Delete account</button>
</form>
```

```ts
// src/routes/account/delete/+page.server.ts
export const actions = {
  delete: async ({ request, locals }) => {
    const data = await request.formData();
    if (data.get('confirm') !== 'DELETE') return fail(400, { message: 'Type DELETE to confirm' });
    await scheduleAccountDeletion(locals.user.id);
    throw redirect(303, '/account/deletion-scheduled');
  },
};
```

**Never** trigger deletion from a `<button onclick="fetch(...)">`.
That path is dead without JS and unreviewable in server logs without
a session trace.

### 6. Search as a form with GET

```svelte
<!-- src/routes/search/+page.svelte -->
<form method="GET" action="/search">
  <label>
    Search
    <input name="q" value={data.query ?? ''} type="search" autocomplete="off" />
  </label>
  <button>Search</button>
</form>

<ul>
  {#each data.results as r}
    <li><a href={r.url}>{r.title}</a></li>
  {/each}
</ul>
```

The URL is shareable, bookmarkable, and indexable — all three features
that JS-only search UIs break.

### 7. Feature detection for the "requires JS" label

```svelte
<!-- src/routes/realtime/chat/+page.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
</script>

<noscript>
  <aside role="alert" class="noscript-notice">
    The real-time chat requires JavaScript. Enable JS or open
    <a href="/messages">the message archive</a> for read-only access.
  </aside>
</noscript>

{#if browser}
  <!-- render the realtime chat -->
{/if}
```

**`<noscript>` plus a graceful-fallback link** — users without JS get
pointed at the static archive. Silent blank pages are hostile.

### 8. Static fallback for third-party iframes

```svelte
<!-- src/lib/components/YouTubeEmbed.svelte -->
<script lang="ts">
  let { videoId, title }: { videoId: string; title: string } = $props();
  let loaded = $state(false);
</script>

{#if loaded}
  <iframe
    src="https://www.youtube-nocookie.com/embed/{videoId}?rel=0"
    {title}
    loading="lazy"
    allow="fullscreen"
    referrerpolicy="strict-origin-when-cross-origin"
  ></iframe>
{:else}
  <a
    class="yt-placeholder"
    href="https://www.youtube.com/watch?v={videoId}"
    onclick={(e) => {
      e.preventDefault();
      loaded = true;
    }}
  >
    <img src="https://i.ytimg.com/vi/{videoId}/hqdefault.jpg" alt="" aria-hidden="true" />
    <span>{title} (plays on YouTube)</span>
  </a>
{/if}
```

No-JS users get a real link to the video. JS users get lazy-loaded
iframe activation + privacy benefit (no cookies until they click).

## A11y invariants

- **Every interactive element is a real element.** `<button>` for
  actions, `<a href>` for navigation, `<input>` for input. Never
  `<div onclick>`.
- **Focus rings are visible** on every interactive element via
  `:focus-visible`. The no-JS path depends on keyboard users seeing
  focus.
- **`aria-invalid` toggles on input + error message is linked via
  `aria-describedby`**. Server-returned validation is announced.
- **Forms that POST redirect to a distinct URL on success** so that
  `aria-live` regions are not required for success feedback — the
  URL change itself is the announcement.
- **`<noscript>` content** is rendered for screen-readers that run
  without JS (NVDA with JS-off in tests); use it for actual guidance
  not decorative content.

## Security invariants

- **CSRF token is a hidden input on every no-JS form** — see
  [csrf-double-submit.md](csrf-double-submit.md). `use:enhance` sends
  the header; the hidden field is the fallback.
- **Never reflect `next` parameter unescaped** in redirects — validate
  against an allowlist or require same-origin path.
- **Form action URLs are stable** — don't generate one-time tokens in
  the URL; the token is in the cookie/field.
- **`SameSite=Lax` cookies** allow top-level POSTs to the origin — that
  is what the no-JS form submission relies on.
- **No secrets in the HTML.** Every form input that carries a nonce
  generates it server-side at render, not via JS.

## Testing

```ts
// e2e/progressive-enhancement.test.ts
import { test, expect } from '@playwright/test';

test.describe('Progressive enhancement', () => {
  test('login works without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/login');
    await page.fill('input[name=email]', 'user@example.com');
    await page.fill('input[name=password]', 'correct-horse-battery-staple');
    await page.click('button[type=submit]');
    await expect(page).toHaveURL('/');
    await context.close();
  });

  test('account update works without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, storageState: 'tests/auth.json' });
    const page = await context.newPage();
    await page.goto('/account');
    await page.fill('input[name=name]', 'New Name');
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/account\?updated=1/);
    await context.close();
  });
});
```

Every form route must have a **no-JS Playwright test**. CI fails if a
form regresses.

```ts
// scripts/progressive-enhancement-audit.ts — CI check
// Crawl the site with JS disabled. Every <form> must have action=
// and method=. Every <a> must have href= (no href="#").
```

## Anti-patterns

1. **`<button onclick={() => fetch(...)}>`** for a mutation — dead
   without JS. Use a form action.
2. **`<a href="javascript:..." />`** or `<a href="#"
   onclick="...">` — violates basic progressive enhancement and
   breaks middle-click-to-open-in-tab.
3. **Modals that have no URL** — can't be shared, can't be bookmarked,
   lost on reload. Use SvelteKit routing.
4. **Redirect to `?success=1` in-place with JS only** — the no-JS
   path must also land on a URL that shows the success state.
5. **Form validation in JS only** — every validation runs on the
   server first; JS layer mirrors.
6. **Using `preventDefault()` inside `use:enhance`** — `enhance` already
   does this. Double-prevent breaks callbacks.
7. **Skipping `method="POST"`** on a destructive form — GET mutations
   are crawler-triggerable and cached.
8. **`action=""`** with ambiguity — either omit `action` or point at
   `?/namedAction`. Don't use a literal empty string.
9. **Client-side redirect (`goto(...)`) for the success path** — the
   server must do the 303.
10. **`autocomplete="off"`** on a login password field — browsers
    ignore it for passwords anyway, but it breaks legit autofill.
11. **Infinite scroll without a fallback paginator** — crawlers can't
    reach deep pages; no-JS users are stuck on page 1.
12. **Custom file input as `<div role="button">`** — keyboard-hostile.
    Style the native `<input type=file>`.
13. **No `<noscript>` on a feature that requires JS** — users hit a
    blank page. Declare the requirement and link to a fallback.
14. **Using `use:enhance` in a block that isn't a `<form>`** — silently
    does nothing. Only works on forms.
15. **Writing the CSRF token in client JS only** — no-JS posts omit
    it; the server rejects. Hidden field is mandatory.
16. **Hiding errors via `display:none` then toggling with JS** — no-JS
    users can't see them. Errors render as HTML; JS enhances.
17. **`<select>` replaced by a JS combobox without `<datalist>`
    fallback** — no-JS users can't select.
18. **Using `<form action="/api/...">`** pointing at a JSON API —
    JSON APIs return JSON; form actions return HTML or redirects.
    Route to a server action, not the API.
19. **Relying on `FormData` on the client to serialize JSON** — works
    only with JS. The server action reads `request.formData()`
    directly.
20. **Toast-only success feedback** — toasts don't render without JS.
    Use a redirect destination with visible page-state change.
21. **`use:enhance` with a no-op custom submit function** — defeats
    the default. Pass no argument or carefully augment.
22. **Skipping `<label for="...">`** or implicit label — some screen
    readers in no-JS mode drop association.
23. **Custom validation message in JS that differs from server
    wording** — inconsistent UX. Server wording is canonical.
24. **Opening `window.open()` from a click handler** without a
    non-JS `<a target="_blank">` fallback.
25. **Making the "Requires JS" notice invisible** (only shown via
    JS) — it needs to render statically.
26. **Rendering placeholders and never showing real content** when JS
    fails. SSR the real data.

## References

- ADRs: [0019](../adr/0019-http-client-and-error-model.md),
  [0003](../adr/0003-forms-superforms.md)
- Siblings: [forms.md](forms.md),
  [error-boundaries.md](error-boundaries.md),
  [csrf-double-submit.md](csrf-double-submit.md),
  [auth-oidc.md](auth-oidc.md)
- SvelteKit: [Form actions](https://kit.svelte.dev/docs/form-actions),
  [`use:enhance`](https://kit.svelte.dev/docs/form-actions#progressive-enhancement)
- HTML Living Standard: `<form>`, `<button type=submit>`, `<a>`
- WCAG 2.2 AA: 2.1.1 Keyboard, 2.4.3 Focus Order, 3.3.1 Error
  Identification
