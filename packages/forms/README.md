# @sveltesentio/forms

> Superforms v2 + Zod v4 thin wrapper with RFC 9457 field-error mapping

Part of the [sveltesentio](https://github.com/golusoris/sveltesentio) composable SvelteKit framework.

## Installation

```bash
pnpm add @sveltesentio/forms
```

## Exports

| Path | Purpose |
|---|---|
| `@sveltesentio/forms` | `superValidate` (Zod v4 pre-wired), `problemToFieldErrors`, `superForm`, proxies, and the Superforms runtime re-exports |
| `@sveltesentio/forms/server` | Server-safe subset — `superValidate` + helpers without client `superForm`/`$app/*` |
| `@sveltesentio/forms/problem` | `problemToFieldErrors` + `FieldErrors` type (zero-dependency pull) |
| `@sveltesentio/forms/action` | `formAction()` — wraps a `+page.server.ts` handler with `superValidate` + `ProblemError → fail({ form })` |
| `@sveltesentio/forms/formsnap` | Formsnap component barrel (`Field`, `Control`, `Label`, …); optional `formsnap@^2` peer |

### `formAction`

```ts
// +page.server.ts
import { formAction } from '@sveltesentio/forms/action';
import { superValidate } from '@sveltesentio/forms/server';
import { fail } from '@sveltejs/kit';
import { schema } from './schema';

export const actions = {
  default: formAction(schema, async ({ form }) => {
    await createUser(form.data); // throws a @sveltesentio/core ProblemError on conflict
    return { form };
  }, { superValidate, fail }),
};
```

A thrown `ProblemError` has its `invalid-params` mapped onto `form.errors` and is
returned as `fail(status, { form })`; any other throwable propagates (→ 500).

See the [monorepo README](../../README.md) and [`docs/`](../../docs/) for design principles and usage.

## License

MIT © lusoris
