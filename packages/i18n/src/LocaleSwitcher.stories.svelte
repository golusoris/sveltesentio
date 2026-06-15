<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LocaleSwitcher from './LocaleSwitcher.svelte';

	interface LocaleOption {
		code: string;
		label: string;
	}

	// A small spread of locales authored in their own script, including one RTL
	// entry (Arabic) so the control demonstrates both directions of label.
	const locales: readonly LocaleOption[] = [
		{ code: 'en-US', label: 'English' },
		{ code: 'de-AT', label: 'Deutsch' },
		{ code: 'fr-FR', label: 'Français' },
		{ code: 'ja-JP', label: '日本語' },
		{ code: 'ar', label: 'العربية' },
	];

	function noop(): void {
		// Stories never mutate app state; the controlled-update side effect is
		// intentionally empty. Use the local-state story to observe selection.
	}

	const { Story } = defineMeta({
		title: 'i18n/LocaleSwitcher',
		component: LocaleSwitcher,
		tags: ['autodocs'],
		argTypes: {
			current: { control: 'text' },
			label: { control: 'text' },
		},
		args: {
			locales,
			current: 'en-US',
			onChange: noop,
		},
	});
</script>

<script lang="ts">
	// Instance-scope reactive state backs the controlled "live" story below.
	let liveCurrent = $state('en-US');
</script>

<!-- Default: a labelled <select> (combobox) with the accessible name "Language". -->
<Story name="Default" args={{ locales, current: 'en-US', onChange: noop }} />

<!-- Pre-selected non-default locale via the controlled `current` value. -->
<Story name="German selected" args={{ locales, current: 'de-AT', onChange: noop }} />

<!-- A localised accessible name; authors source this from their catalogue. -->
<Story
	name="Custom label"
	args={{ locales, current: 'fr-FR', onChange: noop, label: 'Sprache' }}
/>

<!-- An RTL locale selected; the inherited document `dir` flips the control. -->
<Story name="RTL selected" args={{ locales, current: 'ar', onChange: noop }} />

<!--
	Controlled in-story: a tiny harness owns `current` and updates it from
	`onChange`, mirroring how a consumer wires the switcher to its own state
	(and, in an app, to <LangSync>). This is the interactive story.
-->
<Story name="Controlled (live)">
	<LocaleSwitcher
		{locales}
		current={liveCurrent}
		onChange={(code) => {
			liveCurrent = code;
		}}
	/>
</Story>
