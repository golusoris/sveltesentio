<!--
@component
Icon — renders an icon resolved through the pluggable registry (ADR-0002).
Default set is `@lucide/svelte`; apps may `registerIconLoader` (e.g. Iconify) in
`+layout.svelte` to add arbitrary sets with no change here.

A11y: an icon is decorative by default (`aria-hidden`, no role) so it is skipped
by assistive tech. Pass `label` to make it MEANINGFUL — it then becomes
`role="img"` with `aria-label`. Never both. The tested resolution logic lives in
`./registry.ts`; this file is a thin view.
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import { resolveIcon } from './registry.js';

	interface Props {
		/** Icon name, e.g. `arrow-left` (kebab) or `ArrowLeft` (Pascal). */
		name: string;
		/** Pixel size for width + height. Default `24`. */
		size?: number;
		/** Class forwarded to the rendered icon. */
		class?: string;
		/**
		 * Accessible label. When set the icon is MEANINGFUL (`role="img"` +
		 * `aria-label`); when omitted it is decorative (`aria-hidden`).
		 */
		label?: string;
	}

	let { name, size = 24, class: className, label }: Props = $props();

	const resolution = $derived(resolveIcon(name));
	const raw = $derived(resolution?.component);

	// A loader may return a component directly or a Promise (lazy/dynamic import).
	let resolved = $state<Component | undefined>(undefined);

	$effect(() => {
		const value = raw;
		if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
			let active = true;
			void (value as PromiseLike<Component>).then((component) => {
				if (active) resolved = component;
			});
			return () => {
				active = false;
			};
		}
		resolved = value as Component | undefined;
	});

	const decorative = $derived(label === undefined);
	const Resolved = $derived(resolved);
</script>

{#if Resolved}
	<Resolved
		size={size}
		class={className}
		aria-hidden={decorative ? 'true' : undefined}
		role={decorative ? undefined : 'img'}
		aria-label={decorative ? undefined : label}
	/>
{:else}
	<!-- Unresolved name: render an empty, decorative placeholder of the right
	     size so layout does not shift and assistive tech skips it. -->
	<span
		class={className}
		aria-hidden="true"
		style:display="inline-block"
		style:inline-size={`${size}px`}
		style:block-size={`${size}px`}
	></span>
{/if}
