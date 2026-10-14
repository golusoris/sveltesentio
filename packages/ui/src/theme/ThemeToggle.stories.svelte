<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ThemeToggle from './ThemeToggle.svelte';
	import type { ThemeMode } from './mode.js';

	function handleModeChange(next: ThemeMode): void {
		document.documentElement.setAttribute('data-theme-mode', next);
		if (next === 'dark') {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
	}

	const { Story } = defineMeta({
		title: 'ui/theme/ThemeToggle',
		component: ThemeToggle,
		tags: ['autodocs'],
		argTypes: {
			mode: {
				control: 'select',
				options: ['light', 'dark', 'system'],
			},
			showLabel: { control: 'boolean' },
		},
		args: {
			mode: 'light',
			onchange: handleModeChange,
		},
	});
</script>

<!--
	Default story: tri-state toggle cycling light -> dark -> system.
	The play function activates the button and asserts the documented
	class flip on document.documentElement.
-->
<Story
	name="Default"
	asChild
	play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const button = canvasElement.querySelector<HTMLButtonElement>('button');
		if (!button) throw new Error('ThemeToggle button element not found');

		// Click to cycle from light to dark:
		button.click();

		if (!document.documentElement.classList.contains('dark')) {
			throw new Error('Expected document.documentElement to contain class "dark"');
		}
		if (document.documentElement.getAttribute('data-theme-mode') !== 'dark') {
			throw new Error('Expected data-theme-mode="dark" on document.documentElement');
		}

		// Restore documentElement state:
		document.documentElement.classList.remove('dark');
		document.documentElement.removeAttribute('data-theme-mode');
	}}
>
	<ThemeToggle mode="light" onchange={handleModeChange} />
</Story>

<!-- With visible text label next to the mode icon. -->
<Story name="With label" asChild>
	<ThemeToggle mode="system" showLabel={true} onchange={handleModeChange} />
</Story>
