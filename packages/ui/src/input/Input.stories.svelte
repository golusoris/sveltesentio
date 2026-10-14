<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Input from './Input.svelte';

	const { Story } = defineMeta({
		title: 'ui/input/Input',
		component: Input,
		tags: ['autodocs'],
		argTypes: {
			invalid: { control: 'boolean' },
			disabled: { control: 'boolean' },
			type: { control: 'text' },
			placeholder: { control: 'text' },
		},
		args: {
			placeholder: 'you@example.com',
		},
	});
</script>

<!-- Default text input with an explicitly associated <label for="...">. -->
<Story name="Default" asChild>
	<div class="flex flex-col gap-1.5">
		<label for="input-default" class="text-sm font-medium">Email address</label>
		<Input id="input-default" type="email" placeholder="you@example.com" />
	</div>
</Story>

<!--
	Invalid state: sets `aria-invalid="true"`, applies destructive border classes,
	and associates the descriptive error message via `aria-describedby`.
-->
<Story name="Invalid" asChild>
	<div class="flex flex-col gap-1.5">
		<label for="input-invalid" class="text-sm font-medium">Email address</label>
		<Input
			id="input-invalid"
			type="email"
			invalid={true}
			aria-describedby="email-error-text"
			value="malformed-email"
		/>
		<span id="email-error-text" class="text-xs text-destructive">
			Please enter a valid email address.
		</span>
	</div>
</Story>

<!-- Disabled state: forwards disabled attribute to the native <input>. -->
<Story name="Disabled" asChild>
	<div class="flex flex-col gap-1.5">
		<label for="input-disabled" class="text-sm font-medium">Email address</label>
		<Input id="input-disabled" type="email" disabled={true} value="disabled@example.com" />
	</div>
</Story>
