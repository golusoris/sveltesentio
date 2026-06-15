<!--
Test-only icon component mimicking a `@lucide/svelte` icon. `Icon.svelte`
resolves a component from the registry and renders it with `size`, `class`, plus
the a11y attributes it computes (`aria-hidden` OR `role="img"` + `aria-label`).
A real Lucide icon is an `<svg>`; this stub renders one and forwards the rest
props so the a11y attributes land on an element axe + Testing Library can read.
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
	{...rest}
>
	<path d="M4 12h16" />
</svg>
