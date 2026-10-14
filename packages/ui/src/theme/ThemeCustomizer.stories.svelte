<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ThemeCustomizer from './ThemeCustomizer.svelte';
	import type { ThemeOverride } from './customizer.js';

	function handleCustomizerChange(override: ThemeOverride): void {
		for (const [token, value] of Object.entries(override)) {
			if (value) {
				document.documentElement.style.setProperty(`--color-${token}`, value);
			} else {
				document.documentElement.style.removeProperty(`--color-${token}`);
			}
		}
	}

	const { Story } = defineMeta({
		title: 'ui/theme/ThemeCustomizer',
		component: ThemeCustomizer,
		tags: ['autodocs'],
		args: {
			onchange: handleCustomizerChange,
		},
	});
</script>

<!--
	Default story: customizer input fields for semantic tokens.
	The play function edits an input and asserts that the CSS custom
	property is set on document.documentElement.
-->
<Story
	name="Default"
	asChild
	play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const input = canvasElement.querySelector<HTMLInputElement>('#ssentio-theme-primary');
		if (!input) throw new Error('Primary token input not found');

		input.value = 'oklch(0.6 0.2 240)';
		input.dispatchEvent(new Event('input', { bubbles: true }));

		const propertyValue = document.documentElement.style.getPropertyValue('--color-primary');
		if (propertyValue !== 'oklch(0.6 0.2 240)') {
			throw new Error(`Expected --color-primary to be oklch(0.6 0.2 240), got "${propertyValue}"`);
		}

		// Clean up custom property on documentElement:
		document.documentElement.style.removeProperty('--color-primary');
	}}
>
	<ThemeCustomizer onchange={handleCustomizerChange} />
</Story>

<!-- Seeded with initial token overrides. -->
<Story name="With overrides" asChild>
	<ThemeCustomizer
		override={{ primary: 'oklch(0.65 0.24 260)' }}
		onchange={handleCustomizerChange}
	/>
</Story>
