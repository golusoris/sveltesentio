# Primitives — shadcn-svelte CLI (default)

The default primitive-delivery path for `@sveltesentio/ui` is
**`pnpm dlx shadcn-svelte@latest add <component>`**. shadcn-svelte is a
**delivery mechanism** (copy-paste components) over `bits-ui@^2` +
`tailwind-variants` + Lucide — not a runtime dependency. Consumers own
the generated component source, upgrade is manual. For apps that want
tighter control over the wrapper layer, see
[primitives-direct.md](primitives-direct.md).

See [ADR-0014](../adr/0014-shadcn-svelte-cli-primitive-delivery.md) for
the decision. Related: [ADR-0002](../adr/0002-lucide-svelte-default-icons.md)
(Lucide default), [theming.md](theming.md) (oklch token pipeline).

## Why shadcn-svelte

|                                                          | shadcn CLI                     | bits-ui direct      |
| -------------------------------------------------------- | ------------------------------ | ------------------- |
| Source owned by                                          | consumer                       | library             |
| Upgrade path                                             | manual (re-run CLI)            | pnpm update         |
| Tailwind 4 `@theme` wiring                               | pre-wired                      | hand-wired          |
| oklch token bindings                                     | native                         | manual              |
| Copy-paste authoring                                     | yes                            | no                  |
| Wrapper depth                                            | thicker (shadcn adds variants) | thinner             |
| shadcn ecosystem deps (Chart, Carousel, Sonner, Command) | compose cleanly                | compose but re-wrap |

shadcn CLI wins for 90% of surfaces. Apps that need a tighter wrapper
layer (custom behavior across every button, e.g. telemetry) drop into
primitives-direct.

## Install

```bash
pnpm dlx shadcn-svelte@latest init
```

The `init` generates `components.json` + installs peer deps
(`bits-ui`, `tailwind-variants`, `clsx`, `tailwind-merge`, `lucide-svelte`).

### `components.json` conventions

```json
{
  "$schema": "https://shadcn-svelte.com/schema.json",
  "style": "default",
  "tailwind": {
    "config": "src/app.css",
    "css": "src/app.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "$lib/components",
    "utils": "$lib/utils",
    "ui": "$lib/components/ui",
    "hooks": "$lib/hooks",
    "lib": "$lib"
  },
  "typescript": true,
  "registry": "https://shadcn-svelte.com/registry"
}
```

`baseColor` is overridden by `@sveltesentio/ui/tokens` — shadcn's
grayscale palette cascades under the sveltesentio oklch tokens. Keep
`cssVariables: true` so the token overrides work.

## Add a component

```bash
pnpm dlx shadcn-svelte@latest add button
```

Generates `src/lib/components/ui/button/{button.svelte,index.ts}`.
Committed to the repo — consumer owns it.

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
</script>

<Button variant="default">Save</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="destructive" size="lg">Delete</Button>
```

Variants come from `tailwind-variants` — edit the generated
`button.svelte` to add app-specific variants (keep shadcn's as a
starting point).

## Folder layout

```text
src/lib/components/ui/
├── button/
│   ├── button.svelte
│   └── index.ts
├── dialog/
│   ├── dialog.svelte
│   ├── dialog-content.svelte
│   ├── dialog-description.svelte
│   ├── dialog-footer.svelte
│   ├── dialog-header.svelte
│   ├── dialog-title.svelte
│   ├── dialog-trigger.svelte
│   └── index.ts
├── form/ …
└── …
```

Each subdirectory is a single component family. Import via the barrel:

```ts
import * as Dialog from '$lib/components/ui/dialog';
// or
import { Button } from '$lib/components/ui/button';
```

## Token bindings

`@sveltesentio/ui/tokens` ships the oklch tokens (see
[theming.md](theming.md)). shadcn's generated components reference them
directly:

```ts
// button.svelte (generated, then edited)
const buttonVariants = tv({
  base: '...',
  variants: {
    variant: {
      default: 'bg-accent text-accent-fg hover:bg-accent/90',
      destructive: 'bg-danger text-bg hover:bg-danger/90',
      outline: 'border border-border bg-bg hover:bg-muted',
      secondary: 'bg-muted text-muted-fg hover:bg-muted/80',
      ghost: 'hover:bg-muted hover:text-fg',
      link: 'text-accent underline-offset-4 hover:underline',
    },
    // …
  },
});
```

Edit once on generation — replace shadcn's default `bg-primary` etc.
with sveltesentio's semantic tokens (`bg-accent`, `text-accent-fg`).
The `@sveltesentio/ui/preset` ships a shadcn-tokens bridge that keeps
`bg-primary` aliased to `bg-accent` for zero-edit compatibility if you
prefer.

## Upgrading a component

```bash
pnpm dlx shadcn-svelte@latest diff button
# Shows upstream changes

pnpm dlx shadcn-svelte@latest update button
# Rewrites the local component (prompts on conflicts)
```

Commit before running `update` — the diff is the review surface.
Manually merge edits you made locally.

Update rhythm:

- **Monthly** for app code with active UI work — catches bits-ui
  bumps + a11y fixes.
- **Per release** for libraries — ensures consumers inherit the same
  baseline.

## Common components

| Component    | Install             | Notes                                                                 |
| ------------ | ------------------- | --------------------------------------------------------------------- |
| Button       | `add button`        | Sveltesentio tokens: replace `bg-primary` → `bg-accent` on generation |
| Dialog       | `add dialog`        | Focus trap + `aria-modal` out of the box                              |
| Form         | `add form`          | Pairs with [forms.md](forms.md) (Superforms) — Formsnap included      |
| Input        | `add input`         | —                                                                     |
| Select       | `add select`        | bits-ui Select — keyboard-navigable                                   |
| DropdownMenu | `add dropdown-menu` | —                                                                     |
| Command      | `add command`       | Used by [command-palette.md](command-palette.md)                      |
| Sheet        | `add sheet`         | Side drawer; mobile-friendly                                          |
| Sonner       | `add sonner`        | Wrapped further by [toast.md](toast.md)                               |
| Chart        | `add chart`         | Wrapped further by [charts.md](charts.md)                             |
| Carousel     | `add carousel`      | See [carousel.md](carousel.md) for obligations                        |

Full list: <https://shadcn-svelte.com/docs/components>.

## Icons

All shadcn components import icons from `lucide-svelte` (ADR-0002).
Add icons per import:

```svelte
<script lang="ts">
  import { Save, Trash2 } from 'lucide-svelte';
</script>

<Button>
  <Save class="mr-2 size-4" />
  Save
</Button>
```

Never bundle icon sprites — tree-shake per-import keeps the bundle
lean.

## Variant customization

shadcn uses `tailwind-variants` (tv):

```ts
// src/lib/components/ui/button/button.svelte
import { tv, type VariantProps } from 'tailwind-variants';

export const buttonVariants = tv({
  base: 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:ring-ring focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  variants: {
    variant: {
      default: 'bg-accent text-accent-fg hover:bg-accent/90',
      // …
      brand: 'bg-brand text-brand-fg hover:bg-brand/90', // new app variant
    },
    size: {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 px-3',
      lg: 'h-11 px-8',
      icon: 'h-10 w-10',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
```

App-specific variants live alongside shadcn's — don't delete shadcn's
to "clean up" unless certain nothing else uses them.

## Testing

shadcn components ship unit-testable accessibility defaults. Test them
like any other component:

```ts
import { render } from '@testing-library/svelte';
import { axe } from 'jest-axe';
import { Dialog } from '$lib/components/ui/dialog';

test('dialog is axe-clean', async () => {
  const { container } = render(Dialog, { props: { open: true } });
  expect(await axe(container)).toHaveNoViolations();
});
```

Storybook stories render each variant; axe-core runs on each via the
ADR-0031 a11y lane.

## Anti-patterns

- **Importing from `shadcn-svelte` as a runtime dep.** It's not one.
  Components come via CLI, live in app source.
- **Re-running `add <component>` over edited source without diff.**
  Overwrites local edits silently. Use `diff` first, `update` second.
- **Leaving shadcn's default `bg-primary` after generation.** Break
  sveltesentio's token pipeline — the generated component picks up
  shadcn's grayscale palette instead of sveltesentio's oklch tokens.
- **Adding a `@sveltesentio/ui/button` wrapper over shadcn's Button.**
  Duplicates the wrapper — violates streamlining. Edit the generated
  component instead.
- **Copying components manually from the shadcn site.** The CLI wires
  imports, registers in `components.json`, and keeps the registry
  reference. Manual copies drift.
- **Using shadcn's base color `neutral` with `cssVariables: false`.**
  Disables token-based theming entirely. `cssVariables: true` is
  non-optional.
- **Rolling a second primitive layer.** shadcn CLI is the default.
  Direct bits-ui is the escape hatch (primitives-direct.md). Don't
  ship a third.

## References

- ADR-0014 — shadcn-svelte CLI default + primitives-direct escape
  hatch.
- ADR-0002 — Lucide icon default.
- [theming.md](theming.md) — oklch tokens shadcn consumes.
- [primitives-direct.md](primitives-direct.md) — when and how to drop
  into bits-ui directly.
- shadcn-svelte docs: <https://shadcn-svelte.com>.
- tailwind-variants: <https://www.tailwind-variants.org>.
