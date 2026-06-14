# Forms — Superforms vs plain `$state`

Like server state (see [server-state.md](server-state.md)), sveltesentio
supports **two** form paths: Superforms v2 (through `@sveltesentio/forms`)
and hand-rolled `$state` + SvelteKit actions. Neither is "the right one" —
this recipe is the decision flowchart plus the idioms for each.

See [ADR-0003](../adr/0003-forms-thin-superforms-wrapper.md) for the decision.

## TL;DR

```text
                   ┌──────────────────────────────────────┐
                   │ Do you need progressive enhancement  │
                   │ (works without JS) AND server-side   │
                   │ validation reconciliation on the     │
                   │ same request cycle?                  │
                   └──────────────┬───────────────────────┘
                                  │
                         ┌────────┴─────────┐
                         │ yes              │ no
                         ▼                  ▼
                  @sveltesentio/forms   ┌────────────────────────────┐
                  (Superforms v2)       │ Are there ≥3 interrelated  │
                                        │ fields with cross-field    │
                                        │ validation (refine rules)? │
                                        └──────────┬─────────────────┘
                                                   │
                                          ┌────────┴─────────┐
                                          │ yes              │ no
                                          ▼                  ▼
                                   @sveltesentio/forms   Plain $state +
                                                         SvelteKit action
```

## Path 1 — plain `$state` + SvelteKit action

Good for login, simple profile edits, single-field settings, confirm
dialogs. Matches revenge / subdo / Lurkarr patterns.

```svelte
<!-- src/routes/profile/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let name = $state(form?.values?.name ?? '');
  let submitting = $state(false);
</script>

<form
  method="POST"
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      await update();
      submitting = false;
    };
  }}
>
  <label for="name">Name</label>
  <input id="name" name="name" bind:value={name} required />

  {#if form?.errors?.name}
    <p role="alert">{form.errors.name}</p>
  {/if}

  <button type="submit" disabled={submitting}>
    {submitting ? 'Saving…' : 'Save'}
  </button>
</form>
```

```ts
// src/routes/profile/+page.server.ts
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { profileSchema } from './schema';

export const actions: Actions = {
  default: async ({ request }) => {
    const raw = Object.fromEntries(await request.formData());
    const parsed = profileSchema.safeParse(raw);

    if (!parsed.success) {
      return fail(422, {
        values: raw,
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    await saveProfile(parsed.data);
    return { success: true };
  },
};
```

The `values` + `errors` round-trip keeps the form usable without JavaScript
(the action re-renders the page with both populated).

**When this breaks down**: multi-step forms, server-side-only validation
that needs to coexist with client-side hints, file uploads beyond one
input, arrays of nested objects. Migrate to Path 2.

## Path 2 — `@sveltesentio/forms` (Superforms v2 + Zod v4)

Good for multi-step signup, large settings surfaces, dynamic field arrays,
uploads with client-side preview + progress. Matches arca's declared (but
under-used) Superforms investment.

### Install

```bash
pnpm add sveltekit-superforms zod
# Optional bits-ui bindings:
pnpm add formsnap
```

Peer range: `sveltekit-superforms@^2`, `zod@^4`, `formsnap@^2` (optional).
The `@sveltesentio/forms` package re-exports Superforms with the Zod v4
adapter pre-wired — you never pass the adapter explicitly.

### Server side

```ts
// src/routes/signup/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import { superValidate } from '@sveltesentio/forms';
import { signupSchema } from './schema';

export async function load() {
  return { form: await superValidate(signupSchema) };
}

export const actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, signupSchema);

    if (!form.valid) {
      return fail(422, { form });
    }

    await createUser(form.data);
    redirect(303, '/welcome');
  },
};
```

`superValidate(schema)` returns `{ data, errors, valid, ... }`. The Zod v4
adapter is applied automatically — no need for `zod(signupSchema)` like in
upstream Superforms docs.

### Client side

```svelte
<!-- src/routes/signup/+page.svelte -->
<script lang="ts">
  import { superForm } from '@sveltesentio/forms';
  import { signupSchema } from './schema';

  let { data } = $props();

  const { form, errors, enhance, submitting, delayed, tainted } = superForm(
    data.form,
    {
      resetForm: false,
      taintedMessage: 'Unsaved changes. Leave anyway?',
    },
  );
</script>

<form method="POST" use:enhance>
  <label for="email">Email</label>
  <input
    id="email"
    name="email"
    type="email"
    bind:value={$form.email}
    aria-invalid={$errors.email ? 'true' : undefined}
    aria-describedby={$errors.email ? 'email-error' : undefined}
  />
  {#if $errors.email}
    <p id="email-error" role="alert">{$errors.email}</p>
  {/if}

  <!-- …remaining fields -->

  <button type="submit" disabled={$submitting}>
    {$delayed ? 'Still working…' : 'Sign up'}
  </button>
</form>
```

`$delayed` flips to `true` after ~500 ms of pending state — use it for a
gentler "still working" indicator that avoids spinner flash on fast
networks.

### With Formsnap (bits-ui binding)

Optional — lowers boilerplate for accessible field / label / error triples:

```svelte
<script lang="ts">
  import { Control, Label, FieldErrors } from 'formsnap';
  import { superForm } from '@sveltesentio/forms';

  let { data } = $props();
  const form = superForm(data.form);
</script>

<Control let:attrs>
  <Label>Email</Label>
  <input type="email" bind:value={$form.email} {...attrs} />
  <FieldErrors />
</Control>
```

Formsnap wires `aria-invalid` + `aria-describedby` for you.

## Anti-patterns

- **Using both paths in the same form.** `superForm` already manages
  `$state` internally; wrapping it in more runes creates double-render bugs.
- **Calling `.safeParse()` inside a Superforms action.** Use
  `superValidate(request, schema)` — it already parses, reports errors in
  the `form` shape the client expects, and preserves invalid input for
  re-render.
- **Returning unstructured `fail()` payloads.** Always return `{ form }` so
  the client re-initialises cleanly. If you add extra data, namespace it:
  `fail(422, { form, extra: { … } })`.
- **Zod v3 schemas.** Hard rule 12 + ADR-0001: v4 only.
- **Treating Superforms as server state.** The form is UI state — it
  resets on redirect. For cross-route persistence (drafts, wizards), pair
  with `@sveltesentio/query` or a server-backed draft endpoint.
- **Hand-rolling field components when Formsnap fits.** If you end up
  duplicating `aria-invalid` + `aria-describedby` wiring across five
  inputs, adopt Formsnap.

## Migrating from `$state` to Superforms

1. Move the Zod schema out of the `+page.server.ts` into `./schema.ts` (if
   not already).
2. Replace the action body with `const form = await superValidate(request, schema)`.
3. Replace the `enhance` callback with `superForm(data.form).enhance`.
4. Change `form?.errors?.field` reads to `$errors.field`.

No shape change to the Zod schema itself.

## References

- ADR-0003 — thin wrapper decision + rationale for dual-path.
- ADR-0001 — Zod v4 floor (schemas must be v4).
- ADR-0019 — RFC 9457 errors (server errors that reach a form layer flow
  through `ProblemError` first; map into field errors with
  `problemToFieldErrors(err)`).
- Superforms docs: <https://superforms.rocks>.
- Formsnap docs: <https://formsnap.dev>.
