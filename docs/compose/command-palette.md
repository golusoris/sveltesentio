# Command palette — `@sveltesentio/ui/cmd` (bits-ui Command + tinykeys)

`@sveltesentio/ui/cmd` wraps shadcn's Command primitive (which in turn
wraps `bits-ui@^2.16.3`'s `Command`) and bundles `tinykeys@^3` as the
shortcut composer. The wrapper ships a small **command registry** so
apps don't re-implement the ⌘K / Ctrl+K DX per-app. `cmdk-sv` is
deprecated — don't use it.

See [ADR-0015](../adr/0015-ui-cmd-thin-wrapper.md) (thin-wrapper
decision) and [ADR-0025](../adr/0025-bits-ui-command-supersedes-cmdk-sv.md)
(bits-ui Command + tinykeys pin).

## What's in the wrapper

1. Re-export of shadcn's `Command` primitive (Dialog, Input, List, Item,
   Group, Empty, Separator).
2. A `CommandRegistry` + `defineCommand()` API for registering commands
   at module level and per-route.
3. A `tinykeys` shortcut composer that binds a command's `shortcut` to
   its `run` handler globally.
4. `<CommandPalette>` — opinionated Dialog that reads from the registry,
   respects auth-gated items via `@sveltesentio/auth/permissions`, and
   renders shadcn's Command shell.

## Install

```bash
pnpm add @sveltesentio/ui bits-ui tinykeys
pnpm dlx shadcn-svelte@latest add command
```

Peer range: `bits-ui@^2.16.3`, `tinykeys@^3.0.0`, `svelte@^5`.

## Register commands

Define commands at module level (colocated with the feature they belong
to):

```ts
// src/routes/flows/commands.ts
import { defineCommand } from '@sveltesentio/ui/cmd';
import { goto } from '$app/navigation';

export const newFlow = defineCommand({
  id: 'flow.new',
  title: 'New flow',
  description: 'Create a blank flow',
  keywords: ['create', 'add'],
  shortcut: '$mod+n',
  when: ({ permissions }) => permissions.can('edit', { type: 'flow' }),
  run: () => goto('/flows/new'),
  icon: 'Plus',
});

export const searchFlows = defineCommand({
  id: 'flow.search',
  title: 'Search flows…',
  shortcut: '$mod+p',
  run: () => commandPalette.open({ filter: 'flow' }),
  icon: 'Search',
});
```

`$mod` resolves to `Cmd` on macOS, `Ctrl` elsewhere — tinykeys handles
platform normalization. Shortcuts are strings per
[tinykeys grammar](https://github.com/jamiebuilds/tinykeys#key-binding-syntax).

`when` is evaluated lazily against a context containing `permissions`
(see [permissions.md](permissions.md)), the current `page`, and the
`user`. Items that fail `when` are hidden from the palette and their
shortcuts are dormant.

## Mount the palette

One `<CommandPalette>` per app, at the root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { CommandPalette } from '@sveltesentio/ui/cmd';
  import '$lib/commands'; // side-effect registrations (see below)

  let { children } = $props();
</script>

{@render children()}

<CommandPalette />
```

```ts
// src/lib/commands.ts — side-effect registrations
import { registerCommands } from '@sveltesentio/ui/cmd';
import { newFlow, searchFlows } from '../routes/flows/commands';
import { toggleTheme } from './theme-commands';

registerCommands([newFlow, searchFlows, toggleTheme]);
```

The palette binds `$mod+k` to open itself by default — override via
`<CommandPalette openShortcut="$mod+/" />`.

## Route-scoped commands

For commands that only make sense on a specific route, register them
in that route's `+layout.svelte` or `+page.svelte`:

```svelte
<script lang="ts">
  import { useCommands } from '@sveltesentio/ui/cmd';
  import { deleteFlow, exportFlow } from './commands';

  let { data } = $props();

  useCommands([deleteFlow(data.flowId), exportFlow(data.flowId)]);
</script>
```

`useCommands()` registers on mount, unregisters on destroy — no leak,
no cross-route bleed. Shortcut bindings lifecycle with the route.

## Dynamic command providers

For commands computed from async data (recent flows, user picks from
search), provide a function that returns commands:

```ts
import { defineCommandProvider } from '@sveltesentio/ui/cmd';
import { api } from '$lib/api';

export const recentFlowsProvider = defineCommandProvider({
  id: 'flow.recent',
  group: 'Recent flows',
  async list(query) {
    const { data } = await api.GET('/flows/recent', { params: { query: { q: query, limit: 8 } } });
    return data.items.map((f) => ({
      id: `flow.open.${f.id}`,
      title: f.name,
      description: f.description,
      run: () => goto(`/flows/${f.id}`),
      icon: 'FileText',
    }));
  },
});

registerCommandProvider(recentFlowsProvider);
```

Providers are debounced (150ms default) and cancelled when the query
changes — same contract as TanStack Query's `queryFn`. Results are
**not** cached across palette opens; keep the result set small.

## Groups + ordering

Commands render in registration order within their `group`. Groups
render in the order they first appear. Override with `priority`:

```ts
defineCommand({
  id: 'flow.new',
  group: 'Create',
  priority: 100, // higher = earlier within group
  /* … */
});
```

Group names are user-visible — match app copy.

## Keyboard shortcuts outside the palette

`tinykeys` also drives shortcuts that run without opening the palette.
Any command with a `shortcut` is bound globally when registered.
Shortcuts are dormant when an `<input>`, `<textarea>`, or
`contenteditable` element has focus (per tinykeys defaults).

For a shortcut that fires *even when* a field has focus, use
`captureInInputs: true`:

```ts
defineCommand({
  id: 'app.save',
  shortcut: '$mod+s',
  captureInInputs: true, // e.g. save a form from the field
  run: () => saveCurrentForm(),
});
```

## Auth-gated commands

Every command's `when` gets `permissions` from
[permissions.md](permissions.md). A command the user can't run is never
visible and its shortcut is dormant:

```ts
defineCommand({
  id: 'flow.delete',
  title: 'Delete flow…',
  when: ({ permissions, page }) =>
    permissions.can('delete', { type: 'flow', id: page.params.id }),
  run: () => confirmDelete(),
});
```

UI is not the security boundary — Golusoris enforces access on the
actual delete request. The palette's `when` is UX polish only.

## Styling

shadcn's Command primitive uses the same oklch tokens as the rest of
`@sveltesentio/ui`. Override per-preset via `data-preset`:

```css
/* 10-foot preset: larger list items */
:root[data-preset='10foot'] [data-cmd-item] {
  padding-block: 0.75rem;
  font-size: 1.125rem;
}
```

See [theming.md](theming.md).

## Testing

Component tests with Testing Library:

```ts
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { CommandPalette, registerCommands } from '@sveltesentio/ui/cmd';
import { newFlow } from '$lib/routes/flows/commands';

test('palette opens on ⌘K and runs command', async () => {
  const run = vi.fn();
  registerCommands([{ ...newFlow, run }]);
  render(CommandPalette);

  await userEvent.keyboard('{Meta>}k{/Meta}');
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());

  await userEvent.type(screen.getByRole('combobox'), 'new flow');
  await userEvent.keyboard('{Enter}');
  expect(run).toHaveBeenCalledOnce();
});
```

Playwright covers the full shortcut + routing path end-to-end.

## Anti-patterns

- **Hand-rolling palette on raw DOM.** Loses shadcn's Tailwind + a11y
  markup. Use the wrapper.
- **Using `cmdk-sv`.** Deprecated, pre-Svelte-5. ADR-0025 pins bits-ui
  Command.
- **Registering commands from component `<script>` without
  `useCommands()`.** Leaks on navigation — the next route's commands
  stack on top of the previous.
- **Using `$permissions` runes in `when`.** No such rune exists; use
  the `permissions` context the registry provides (sourced from
  `page.data` per [permissions.md](permissions.md)).
- **Binding the same shortcut to multiple commands.** Last registration
  wins silently — confusing. The wrapper logs a `console.warn` in dev.
- **Relying on the palette as the only way to invoke a command.**
  Palette is discovery. Every command should be reachable via a normal
  UI affordance too (button, menu item, link).
- **Putting long-running work in `run`.** `run` should navigate, open a
  dialog, or dispatch — not await 5s of network. The palette closes
  immediately on Enter; long work without feedback is broken UX.

## References

- ADR-0015 — thin `ui/cmd` wrapper.
- ADR-0025 — bits-ui Command supersedes `cmdk-sv`; tinykeys pin.
- [permissions.md](permissions.md) — `when` context shape.
- bits-ui Command: <https://bits-ui.com/docs/components/command>.
- tinykeys grammar: <https://github.com/jamiebuilds/tinykeys>.
