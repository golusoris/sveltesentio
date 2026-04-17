# Skill: add-form

Generate a complete Superforms v2 + Zod v4 form: schema, server action, and client component.

## When to use

When the user asks to add a form to a SvelteKit route (login, signup, settings, CRUD, etc.).

## Files to generate

Given a route at `src/routes/<route>/`:

### 1. `schema.ts`

```typescript
import { z } from 'zod';

export const formSchema = z.object({
  // Example fields — adapt to the actual form:
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
});

export type FormData = z.infer<typeof formSchema>;
```

### 2. `+page.server.ts`

```typescript
import { superValidate, fail } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { formSchema } from './schema.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  return { form: await superValidate(zod4(formSchema)) };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await superValidate(request, zod4(formSchema));
    if (!form.valid) return fail(400, { form });

    // TODO: handle valid submission
    // await db.insert(...)

    return { form };
  },
};
```

### 3. `+page.svelte`

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import type { PageData } from './$types.js';

  const { data }: { data: PageData } = $props();

  const { form, errors, enhance, submitting } = superForm(data.form, {
    dataType: 'json',
  });
</script>

<form method="POST" use:enhance>
  <label>
    Email
    <input type="email" name="email" bind:value={$form.email} aria-invalid={!!$errors.email} />
    {#if $errors.email}<span role="alert">{$errors.email}</span>{/if}
  </label>

  <button type="submit" disabled={$submitting}>
    {$submitting ? 'Saving…' : 'Submit'}
  </button>
</form>
```

## Rules

- Always `trim()` string inputs in the schema
- Always return `fail(400, { form })` — never throw on validation error
- `aria-invalid` on inputs when errors present
- Error messages in `role="alert"` spans
- Disable submit button while `$submitting`
- Use `dataType: 'json'` for nested objects / arrays
