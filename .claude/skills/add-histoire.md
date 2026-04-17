# Skill: add-histoire

Add a Histoire story for a component.

## When to use

When the user asks to document a component or create a visual story/preview.

## File naming

Stories live next to the component: `Button.svelte` → `Button.story.svelte`

## Template

```svelte
<script lang="ts">
  import { Story, Template, Variant } from 'histoire/svelte';
  import Button from './Button.svelte';
</script>

<Story title="Components/Button" icon="lucide:square">
  <Template let:args>
    <Button {...args} />
  </Template>

  <Variant title="Primary" args={{ variant: 'default', size: 'default' }}>
    <Button>Primary</Button>
  </Variant>

  <Variant title="Destructive" args={{ variant: 'destructive' }}>
    <Button variant="destructive">Delete</Button>
  </Variant>

  <Variant title="Ghost" args={{ variant: 'ghost' }}>
    <Button variant="ghost">Ghost</Button>
  </Variant>
</Story>
```

## Running Histoire

```bash
pnpm --filter @sveltesentio/ui histoire dev
# opens at http://localhost:6006
```

## Rules

- One `.story.svelte` file per component
- Cover all variants and states (default, hover, disabled, error)
- Include a11y notes if the component has ARIA requirements
- Dark and light mode both tested via the Histoire theme switcher
