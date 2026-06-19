<!--
@component
ThemeToggle — tier-2 light/dark/system mode toggle (ADR-0046, ADR-0048). A single
button that cycles light → dark → system; the pure tri-state logic is the
unit-tested `./mode.ts`. Peer-free: the actual `<html class="dark">` flip is the
consumer's job (typically `mode-watcher`, an OPTIONAL peer) via the `onchange`
callback. `mode` is bindable so it can be seeded from the server-read cookie.

A11y: a native `<button>` with a descriptive `aria-label` ("Theme: System.
Activate to switch.") and `aria-live`-friendly text label; the current mode is
also exposed via `data-mode` for styling. Keyboard-operable for free.
-->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { buttonClass } from '../button/variants.js';
	import { modeLabel, nextMode, type ThemeMode, type ThemeModeChange } from './mode.js';

	interface Props extends Omit<HTMLButtonAttributes, 'onchange'> {
		/** Current mode (bindable). Seed from the server-read `theme` cookie. */
		mode?: ThemeMode;
		/** Called with the next mode after each activation (wire to mode-watcher). */
		onchange?: ThemeModeChange;
		/** Show the mode text next to the state. Default `false` (icon-only). */
		showLabel?: boolean;
		/** Extra classes appended to the button. */
		class?: string;
	}

	let {
		mode = $bindable('system'),
		onchange,
		showLabel = false,
		class: className,
		...rest
	}: Props = $props();

	const label = $derived(modeLabel(mode));
	const classes = $derived(buttonClass('ghost', showLabel ? 'default' : 'icon', className));

	function cycle(): void {
		mode = nextMode(mode);
		onchange?.(mode);
	}
</script>

<button
	type="button"
	class={classes}
	data-mode={mode}
	aria-label={`Theme: ${label}. Activate to switch.`}
	onclick={cycle}
	{...rest}
>
	<!-- A glyph per mode; decorative (the button carries the accessible name). -->
	<span aria-hidden="true">
		{#if mode === 'light'}☀{:else if mode === 'dark'}☾{:else}◐{/if}
	</span>
	{#if showLabel}<span>{label}</span>{/if}
</button>
