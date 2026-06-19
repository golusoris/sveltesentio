<!--
@component
Input — peer-free default matching the shadcn-svelte Input class contract
(ADR-0014). The class logic is the pure, unit-tested `./variants.ts`; this file is
a thin view forwarding rest props to a native `<input>`, with `value` bindable.

A11y: a native `<input>` (label association is the caller's job — pair with a
`<label for>` or `aria-label`). When `invalid` is set the element also gets
`aria-invalid="true"` so assistive tech announces the error, and the destructive
token classes apply. `type` is forwarded; defaults to `text`.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { inputClass } from './variants.js';

	interface Props extends Omit<HTMLInputAttributes, 'value'> {
		/** Bindable field value. */
		value?: string;
		/** Invalid state — applies destructive classes + `aria-invalid`. */
		invalid?: boolean;
		/** Extra classes appended after the resolved base classes. */
		class?: string;
	}

	let {
		value = $bindable(''),
		invalid = false,
		class: className,
		type = 'text',
		...rest
	}: Props = $props();

	const classes = $derived(inputClass(invalid, className));
</script>

<input
	{type}
	class={classes}
	aria-invalid={invalid ? 'true' : undefined}
	bind:value
	{...rest}
/>
