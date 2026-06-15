<!--
@component
StubIcon — a self-contained SVG used only by Icon.stories.svelte so the `<Icon>`
component renders in Storybook WITHOUT the optional `@lucide/svelte` peer. It
accepts the same forwarded props Icon.svelte passes to a resolved icon (`size`,
`class`, and the `aria-*` / `role` a11y attributes). Lives in the storybook app
(not packages/ui/src) so it never ships in the published `@sveltesentio/ui` tarball.
-->
<script lang="ts">
  interface Props {
    size?: number;
    class?: string;
    'aria-hidden'?: 'true' | undefined;
    'aria-label'?: string | undefined;
    role?: 'img' | undefined;
  }

  let {
    size = 24,
    class: className,
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    role,
  }: Props = $props();
</script>

<svg
  class={className}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={ariaHidden}
  aria-label={ariaLabel}
  {role}
>
  <rect x="3" y="3" width="18" height="18" rx="3" />
  <path d="M8 12h8M12 8v8" />
</svg>
