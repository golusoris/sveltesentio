<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Button from './Button.svelte';

	const { Story } = defineMeta({
		title: 'ui/button/Button',
		component: Button,
		tags: ['autodocs'],
		argTypes: {
			variant: {
				control: 'select',
				options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
			},
			size: {
				control: 'select',
				options: ['default', 'sm', 'lg', 'icon'],
			},
			disabled: { control: 'boolean' },
			type: { control: 'text' },
		},
		args: {
			variant: 'default',
			size: 'default',
		},
	});
</script>

<!-- One story per variant, matching the shadcn-svelte Button variant set (ADR-0014). -->
<Story name="Default" asChild>
	<Button variant="default">Default</Button>
</Story>

<Story name="Destructive" asChild>
	<Button variant="destructive">Destructive</Button>
</Story>

<Story name="Outline" asChild>
	<Button variant="outline">Outline</Button>
</Story>

<Story name="Secondary" asChild>
	<Button variant="secondary">Secondary</Button>
</Story>

<Story name="Ghost" asChild>
	<Button variant="ghost">Ghost</Button>
</Story>

<Story name="Link" asChild>
	<Button variant="link">Link</Button>
</Story>

<!-- Control sizes: sm, default, lg, icon (icon keeps a square target + aria-label). -->
<Story name="Sizes" asChild>
	<div class="flex items-center gap-2">
		<Button size="sm">Small</Button>
		<Button size="default">Default</Button>
		<Button size="lg">Large</Button>
		<Button size="icon" aria-label="Settings">⚙</Button>
	</div>
</Story>

<!-- Disabled: natively removed from the tab order via disabled attribute. -->
<Story name="Disabled" asChild>
	<div class="flex items-center gap-2">
		<Button disabled>Disabled</Button>
		<Button variant="outline" disabled>Disabled outline</Button>
	</div>
</Story>
