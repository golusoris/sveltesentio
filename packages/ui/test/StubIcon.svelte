<!--
Stand-in for a `@lucide/svelte` icon, shared by `Icon.svelte.test.ts` and
`Icon.stories.svelte`. The default icon set is an optional peer that neither
the tests nor Storybook install. `Icon.svelte` renders a resolved icon with
`size`, `class` and the a11y attributes it computes (`aria-hidden`, or
`role="img"` plus `aria-label`). Like a real Lucide icon, this stub is an
`<svg>` that forwards the rest props, so those attributes land on an element
axe and Testing Library can read. It lives under test/, outside the package's
`files`, so it never ships.
-->
<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
		[key: string]: unknown;
	}

	const { size = 24, class: className, ...rest }: Props = $props();
</script>

<svg
	data-testid="stub-icon"
	class={className}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	{...rest}
>
	<rect x="3" y="3" width="18" height="18" rx="3" />
	<path d="M8 12h8M12 8v8" />
</svg>
