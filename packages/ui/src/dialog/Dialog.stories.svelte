<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Dialog from './Dialog.svelte';
	import Button from '../button/Button.svelte';

	async function waitForPanelActive(canvasElement: HTMLElement): Promise<HTMLElement> {
		for (let i = 0; i < 50; i += 1) {
			const panel = canvasElement.querySelector<HTMLElement>('[role="dialog"]');
			const active = document.activeElement;
			if (panel?.contains(active)) return panel;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error('Expected document.activeElement to be inside the dialog panel after open');
	}

	async function waitForPanelRemoval(canvasElement: HTMLElement): Promise<void> {
		for (let i = 0; i < 50; i += 1) {
			if (!canvasElement.querySelector('[role="dialog"]')) return;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error('Expected dialog panel to be removed from canvas on Escape');
	}

	const { Story } = defineMeta({
		title: 'ui/dialog/Dialog',
		component: Dialog,
		tags: ['autodocs'],
		argTypes: {
			open: { control: 'boolean' },
			title: { control: 'text' },
			description: { control: 'text' },
			dismissible: { control: 'boolean' },
		},
		args: {
			open: true,
			title: 'Confirm deletion',
			description: 'This action cannot be undone. This will permanently remove your project.',
		},
	});
</script>

<script lang="ts">
	let open = $state(true);
</script>

<!-- Open modal dialog with title, description, body content, and close buttons. -->
<Story name="Open" asChild>
	<Dialog
		open={true}
		title="Confirm deletion"
		description="This action cannot be undone. This will permanently remove your project."
	>
		<p class="py-2 text-sm text-muted-foreground">
			All associated deployment targets and databases will be decommissioned.
		</p>
		{#snippet footer()}
			<Button variant="outline">Cancel</Button>
			<Button variant="destructive">Delete project</Button>
		{/snippet}
	</Dialog>
</Story>

<!-- Modal dialog without description (aria-describedby is cleanly omitted). -->
<Story name="Without description" asChild>
	<Dialog open={true} title="Action completed">
		<p class="py-2 text-sm">Your changes have been saved to the remote repository.</p>
		{#snippet footer()}
			<Button variant="default">Close</Button>
		{/snippet}
	</Dialog>
</Story>

<!-- Interactive keyboard focus trap and Escape dismissal test. -->
<Story
	name="Keyboard"
	asChild
	play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const panel = await waitForPanelActive(canvasElement);

		const buttons = panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
		const firstButton = buttons[0];
		const lastButton = buttons[buttons.length - 1];
		if (!firstButton || !lastButton) {
			throw new Error('Focusable buttons not found in panel');
		}

		lastButton.focus();
		lastButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

		if (document.activeElement !== firstButton) {
			throw new Error('Expected activeElement to wrap to the first focusable element in the panel');
		}

		firstButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await waitForPanelRemoval(canvasElement);
	}}
>
	<Dialog
		bind:open
		title="Keyboard navigation"
		description="Verify focus-trap wrapping and Escape key dismissal."
	>
		<p class="py-2 text-sm text-muted-foreground">Focus trap testing content.</p>
		{#snippet footer()}
			<Button variant="outline">Cancel</Button>
			<Button variant="destructive">Confirm</Button>
		{/snippet}
	</Dialog>
</Story>
