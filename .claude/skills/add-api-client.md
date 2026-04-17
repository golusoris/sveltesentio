# Skill: add-api-client

Generate a type-safe API client from an OpenAPI spec using openapi-typescript + openapi-fetch.

## When to use

When wiring a SvelteKit app to a golusoris (or any OpenAPI-compliant) backend.

## Steps

### 1. Generate types from the spec

```bash
# From the app root — point at the running backend or a spec file
npx openapi-typescript http://localhost:8080/openapi.json -o src/lib/api/schema.ts
# Or from a file:
npx openapi-typescript openapi.yaml -o src/lib/api/schema.ts
```

### 2. Create the client singleton at `src/lib/api/client.ts`

```typescript
import createClient from 'openapi-fetch';
import type { paths } from './schema.js';
import { PUBLIC_API_BASE_URL } from '$env/static/public';

export const apiClient = createClient<paths>({ baseUrl: PUBLIC_API_BASE_URL });
```

### 3. Use in a SvelteKit load function

```typescript
// src/routes/items/+page.server.ts
import { apiClient } from '$lib/api/client.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch }) => {
  const { data, error: apiError } = await apiClient.GET('/items', {
    fetch, // use SvelteKit's fetch for SSR deduplication
  });

  if (apiError) throw error(500, 'Failed to load items');
  return { items: data };
};
```

### 4. Mutations via TanStack Query

```typescript
// src/routes/items/+page.svelte
import { createMutation } from '@sveltesentio/query';
import { apiClient } from '$lib/api/client.js';

const deleteItem = createMutation({
  mutationFn: (id: string) => apiClient.DELETE('/items/{id}', { params: { path: { id } } }),
  onSuccess: () => toast.success('Deleted'),
  onError: () => toast.error('Failed to delete'),
  invalidates: [['items']], // invalidates matching TanStack Query cache keys
});
```

## Rules

- Regenerate `schema.ts` whenever the backend spec changes — never hand-edit it
- Always forward SvelteKit's `fetch` in server-side calls (enables SSR deduplication + cookie forwarding)
- Never expose the API client directly to client-side code — use TanStack Query mutations/queries
- `PUBLIC_API_BASE_URL` must be in `.env` + validated by `createEnv()` from `@sveltesentio/core`
