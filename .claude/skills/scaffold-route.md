# Skill: scaffold-route

Generate a SvelteKit route with Superforms + TanStack Query patterns.

## When to use

When the user asks to create a new SvelteKit page/route.

## Files to generate

For route `/routes/<path>/`:

### `+page.server.ts` (server actions + load)

```typescript
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { fail } from '@sveltejs/kit';
import { mySchema } from './schema.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch, locals }) => {
  // server data fetching here
  const form = await superValidate(zod(mySchema));
  return { form };
};

export const actions: Actions = {
  default: async ({ request, fetch, locals }) => {
    const form = await superValidate(request, zod(mySchema));
    if (!form.valid) return fail(400, { form });
    // handle action
    return { form };
  },
};
```

### `+page.ts` (client load + TanStack Query)

```typescript
import { createQuery } from '@tanstack/svelte-query';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async ({ data, fetch }) => {
  return { ...data };
};
```

### `+page.svelte` (component)

```svelte
<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { createQuery } from '@tanstack/svelte-query';
  import type { PageData } from './$types.js';

  const { data }: { data: PageData } = $props();
  const { form, errors, enhance } = superForm(data.form);
</script>

<form method="POST" use:enhance>
  <!-- fields here -->
</form>
```

### `schema.ts` (Zod schema)

```typescript
import { z } from 'zod';

export const mySchema = z.object({
  // define fields
});

export type MySchema = typeof mySchema;
```

## Rules

- Always use `+page.server.ts` for mutations (not client-side fetch)
- Always validate with Zod via Superforms
- Use TanStack Query for read-only data that needs client-side caching
- Never put sensitive logic in `+page.ts` (runs on client)
