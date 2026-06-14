<!--
@component
LocaleSwitcher — an accessible locale picker (ADR-0018 a11y action item #2). A
native, labelled `<select>`: keyboard-operable for free, exposes an accessible
name (WCAG 2.2 SC 4.1.2), and pairs naturally with `<LangSync>` — the consumer
updates its own `locale` state from `onChange`, and `<LangSync>` reflects it
onto `<html lang/dir>`.

Controlled: the parent owns the current value and re-renders on change. The
`<select>` carries the document's text direction implicitly via the inherited
`dir`; option labels should be authored in each locale's own script.

No pure logic to extract — it is a thin, controlled form control.
-->
<script lang="ts">
	/** One selectable locale: its BCP-47 `code` and human-readable `label`. */
	interface LocaleOption {
		code: string;
		label: string;
	}

	interface Props {
		/** The locales offered, in display order. */
		locales: readonly LocaleOption[];
		/** The currently active locale `code` (controlled). */
		current: string;
		/** Invoked with the newly selected locale `code`. */
		// eslint-disable-next-line no-unused-vars -- name in a function-type is type-position-only; svelte-eslint-parser misreports it as an unused binding
		onChange: (code: string) => void;
		/**
		 * Accessible name for the control. Default `'Language'`. Authors should
		 * localise this string through their message catalogue.
		 */
		label?: string;
		/** Optional id for the `<select>`; auto-derived when omitted. */
		id?: string;
	}

	const {
		locales,
		current,
		onChange,
		label = 'Language',
		id,
	}: Props = $props();

	const selectId = $derived(id ?? 'sentio-locale-switcher');

	function handleChange(event: Event): void {
		const target = event.currentTarget as HTMLSelectElement;
		onChange(target.value);
	}
</script>

<div class="ssentio-locale-switcher">
	<label class="ssentio-locale-switcher__label" for={selectId}>{label}</label>
	<select
		id={selectId}
		class="ssentio-locale-switcher__select"
		value={current}
		onchange={handleChange}
	>
		{#each locales as locale (locale.code)}
			<option value={locale.code}>{locale.label}</option>
		{/each}
	</select>
</div>

<style>
	.ssentio-locale-switcher {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.ssentio-locale-switcher__select {
		min-block-size: var(--ui-min-target-size, 24px);
		padding-block: 0.25rem;
		padding-inline: 0.5rem;
	}

	.ssentio-locale-switcher__select:focus-visible {
		outline: 2px solid var(--ui-ring, currentColor);
		outline-offset: 2px;
	}
</style>
