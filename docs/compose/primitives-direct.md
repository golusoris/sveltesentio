# Primitives — bits-ui direct (escape hatch)

The default primitive path is shadcn-svelte CLI
([primitives-shadcn.md](primitives-shadcn.md)). This recipe documents
the **escape hatch**: consuming `bits-ui@^2` directly with
`tailwind-variants` for apps that want a tighter wrapper layer — e.g.
custom telemetry across every Button, a shared `data-*` contract, or
simply thinner generated code.

See [ADR-0014](../adr/0014-shadcn-svelte-cli-primitive-delivery.md) for
the decision and when to prefer this path. Evidence: subdo + revenge
compose bits-ui directly today and this recipe documents their pattern.

## When to use this path

Use direct bits-ui when **all** of these apply:

- You need a cross-cutting invariant on every primitive (analytics,
  logging, i18n wrapping, custom `data-testid` policy).
- Your team is comfortable maintaining the wrapper layer long-term.
- shadcn's generated source is not an improvement over a hand-written
  wrapper for your case.

Use shadcn CLI when **any** of these apply:

- You want copy-paste authoring speed.
- You'll use shadcn's Chart / Carousel / Sonner / Command — those
  compose cleanly with shadcn's Button/Dialog/etc.
- No team-wide invariant justifies the extra wrapper surface.

Mixing is fine — subdo wraps Button directly for telemetry but uses
shadcn's Dialog. Don't mix **within** a component family.

## Install

```bash
pnpm add bits-ui tailwind-variants clsx tailwind-merge lucide-svelte
```

Peer range: `bits-ui@^2.16`, `tailwind-variants@^1`, `svelte@^5`.

## Utility setup

```ts
// src/lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Same `cn()` helper shadcn uses — order-preserving Tailwind merge.

## Button example

```svelte
<!-- src/lib/ui/Button.svelte -->
<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';

  export const buttonVariants = tv({
    base: 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:ring-ring focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent/90',
        outline: 'border border-border bg-bg hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-danger text-bg hover:bg-danger/90',
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
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { track } from '$lib/telemetry'; // app-specific invariant

  let {
    variant = 'default',
    size = 'default',
    class: className,
    event,
    children,
    onclick,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    event?: string; // telemetry key — team-wide invariant
  } = $props();

  function onClickWithTelemetry(e: MouseEvent) {
    if (event) track(event);
    onclick?.(e);
  }
</script>

<button
  class={cn(buttonVariants({ variant, size }), className)}
  onclick={onClickWithTelemetry}
  {...rest}
>
  {@render children?.()}
</button>
```

The telemetry is the cross-cutting invariant. shadcn's generated Button
doesn't embed it; the direct-wrap version does. That's the justification.

## Dialog example

```svelte
<!-- src/lib/ui/Dialog.svelte -->
<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { X } from 'lucide-svelte';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    description,
    children,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<DialogPrimitive.Root bind:open>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="data-[state=open]:animate-in data-[state=closed]:animate-out fixed inset-0 z-50 bg-black/60"
    />
    <DialogPrimitive.Content
      class={cn(
        'bg-bg text-fg border-border data-[state=open]:animate-in data-[state=closed]:animate-out fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border p-6 shadow-lg sm:rounded-lg',
      )}
    >
      <DialogPrimitive.Title class="text-lg font-semibold">
        {title}
      </DialogPrimitive.Title>
      {#if description}
        <DialogPrimitive.Description class="text-muted-fg text-sm">
          {description}
        </DialogPrimitive.Description>
      {/if}
      {@render children()}
      <DialogPrimitive.Close
        class="ring-offset-bg focus:ring-ring absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
        aria-label="Close"
      >
        <X class="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

Compare to shadcn's 5-file Dialog generation — direct-wrap is leaner if
you want that. You trade shadcn's out-of-the-box sub-components
(`Dialog.Header`, `Dialog.Footer`) for inlined markup.

## What bits-ui gives you

All the hard parts:

- Focus trap + focus return on close
- `role` + `aria-modal` + `aria-labelledby` / `aria-describedby` wiring
- Escape-key close + outside-click close
- Portal for z-index isolation
- Scroll lock on body
- Animation hooks via `data-state="open"` / `"closed"`

You wrap the styling. Don't re-implement the a11y.

## Common primitives

| bits-ui primitive | Typical use |
|---|---|
| `Dialog` | Modal dialogs |
| `AlertDialog` | Confirm / destructive actions (non-dismissable overlay) |
| `Select` | Accessible select with keyboard nav |
| `Combobox` | Typeahead select |
| `Command` | Command palette (see [command-palette.md](command-palette.md)) |
| `DropdownMenu` / `Menubar` / `ContextMenu` | Menus |
| `Tooltip` | Tooltips with delay group |
| `Popover` | Non-modal overlays |
| `Tabs` | Tabbed surfaces |
| `Accordion` | Collapsible sections |
| `Checkbox` / `RadioGroup` / `Switch` | Form controls |
| `Slider` / `Progress` | Range / progress |
| `Toggle` / `ToggleGroup` | Toggle buttons |
| `Avatar` | Avatar w/ fallback |
| `ScrollArea` | Styled scroll container |
| `DateField` / `DatePicker` / `RangeCalendar` | Accessible date inputs |

Full list: <https://bits-ui.com/docs/components>.

## File layout

```text
src/lib/ui/
├── Button.svelte
├── Dialog.svelte
├── Select.svelte
├── tv.ts              # re-export of tailwind-variants + shared variants
└── index.ts
```

Flatter than shadcn's family-per-directory — because you're writing less
code per primitive. If a primitive grows a sub-component (Dialog.Footer),
introduce a subdirectory at that point.

## Variants across primitives

Share variant definitions between primitives with a common `tv.ts`:

```ts
// src/lib/ui/tv.ts
import { tv } from 'tailwind-variants';

export const focusRing = 'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none';

export const pressable = tv({
  base: `${focusRing} transition-colors disabled:pointer-events-none disabled:opacity-50`,
});
```

Keeps focus-ring logic, disabled states, and transitions consistent
across Button / Toggle / Switch / ToggleGroup.

## Icons

Same as shadcn — `lucide-svelte` per ADR-0002:

```svelte
<script lang="ts">
  import { ChevronDown } from 'lucide-svelte';
</script>

<ChevronDown class="size-4 opacity-50" />
```

## Testing

Test the wrapper with Testing Library + axe-core:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import Button from '$lib/ui/Button.svelte';

test('telemetry fires on click', async () => {
  const track = vi.fn();
  vi.mock('$lib/telemetry', () => ({ track }));

  render(Button, { props: { event: 'save.click', children: () => 'Save' } });
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  expect(track).toHaveBeenCalledWith('save.click');
});

test('Dialog is axe-clean when open', async () => {
  const { container } = render(Dialog, { props: { open: true, title: 'Test' } });
  expect(await axe(container)).toHaveNoViolations();
});
```

## Upgrading bits-ui

bits-ui is a runtime dep — `pnpm update bits-ui`. Major bumps may
rename props or restructure slots; follow the bits-ui changelog.
Unlike shadcn CLI (consumer owns source), you don't rewrite your
wrapper — you adapt to bits-ui's API change. Trade-off: less drift,
less authoring speed.

## Migration — shadcn → direct

If you started on shadcn and want to migrate a component family to
direct:

1. Identify the cross-cutting invariant (telemetry, logging, data-*).
2. Write the direct wrapper alongside shadcn's generated version.
3. Swap imports: `$lib/components/ui/button` → `$lib/ui/Button`.
4. Delete shadcn's source for that family.
5. Update `components.json`:

   ```json
   {
     "aliases": {
       "components": "$lib/components",
       "ui": "$lib/ui" // or omit entirely for direct-only
     }
   }
   ```

Mixed strategy (shadcn for most, direct for a subset) is normal.

## Anti-patterns

- **Direct-wrapping without a cross-cutting invariant.** Re-authors
  what shadcn CLI generates for free. Justify the wrapper.
- **Using `tailwind-variants` without `tailwind-merge` / `clsx`.**
  Last-wins class application breaks override ergonomics. Always
  compose via `cn()`.
- **Re-implementing bits-ui's a11y.** Focus trap, ARIA wiring, key
  handlers — bits-ui owns these. You wrap the styling.
- **Importing from `bits-ui/internals`.** No stability guarantee. Use
  the public surface.
- **Mixing direct-wrapped and shadcn-generated versions of the same
  component.** One per family. Consumers shouldn't have to think about
  which Button they're importing.
- **Tailwind `@apply` inside component source.** shadcn uses utilities
  inline; `@apply` loses responsive/variant modifiers. Stay
  utility-first.
- **Dropping ADR-0014 escape-hatch status.** This is the minority
  path. Default is [primitives-shadcn.md](primitives-shadcn.md).

## References

- ADR-0014 — primitive delivery policy.
- ADR-0002 — Lucide icon default.
- [primitives-shadcn.md](primitives-shadcn.md) — the default path.
- [theming.md](theming.md) — oklch tokens.
- bits-ui docs: <https://bits-ui.com>.
- tailwind-variants: <https://www.tailwind-variants.org>.
