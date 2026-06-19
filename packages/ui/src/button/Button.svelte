<!--
@component
Button — peer-free default matching the shadcn-svelte Button class contract
(ADR-0014). The variant/size class logic is the pure, unit-tested `./variants.ts`;
this file is a thin view that forwards rest props to a native `<button>`.

A11y: a real `<button>` element (focusable, Enter/Space activation, exposed as
`role="button"` for free). `disabled` natively removes it from the tab order; an
icon-only button MUST pass `aria-label` (enforced by the caller, surfaced in the
axe test). Tabler/Lucide icons go in the default slot.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { buttonClass, type ButtonSize, type ButtonVariant } from './variants.js';

	interface Props extends HTMLButtonAttributes {
		/** Visual emphasis. Default `default`. */
		variant?: ButtonVariant;
		/** Control size. `icon` is square for icon-only buttons. Default `default`. */
		size?: ButtonSize;
		/** Extra classes appended after the resolved variant/size classes. */
		class?: string;
		/** Button label / content. */
		children?: Snippet;
	}

	let {
		variant = 'default',
		size = 'default',
		class: className,
		type = 'button',
		children,
		...rest
	}: Props = $props();

	const classes = $derived(buttonClass(variant, size, className));
</script>

<button {type} class={classes} {...rest}>
	{@render children?.()}
</button>
