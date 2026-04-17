# Skill: add-shadcn

Add a shadcn-svelte component to an app using the sveltesentio CLI wrapper.

## When to use

When the user asks to add a UI component (button, dialog, card, etc.).

## How it works

The `@sveltesentio/ui` CLI wrapper calls `npx shadcn-svelte@next add` under the hood,
then applies sveltesentio's design token overrides.

## Command

```bash
# In the app directory (not the monorepo root)
cd apps/<app-name>

# Add one or more components
npx shadcn-svelte@next add button
npx shadcn-svelte@next add dialog card badge
```

Components are copied to `src/lib/components/ui/<name>/` — the app owns the code.

## After adding

1. Verify the component uses the sveltesentio CSS token variables (not hardcoded colors)
2. Check that the component is axe-core clean: `pnpm test` should pass with 0 a11y violations
3. If the component needs dark/light variants, use `mode-watcher` + the interface-type preset tokens

## Available components (shadcn-svelte v2)

accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button,
calendar, card, carousel, chart, checkbox, collapsible, command, context-menu,
data-table, date-picker, dialog, drawer, dropdown-menu, form, hover-card, input,
input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group,
resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner,
switch, table, tabs, textarea, toast, toggle, toggle-group, tooltip

## Design token mapping

shadcn-svelte uses CSS custom properties that map to sveltesentio tokens:
- `--background` → `--surface`
- `--foreground` → `--text-primary`
- `--primary` → `--color-primary`
- `--destructive` → `--color-critical`
- `--muted` → `--surface-elevated`
