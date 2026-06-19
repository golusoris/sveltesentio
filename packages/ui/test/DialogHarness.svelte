<!--
Test harness wrapping Dialog.svelte with body + footer content (two focusable
buttons in the footer) so the focus-trap + axe assertions have real focusables to
work with. Exposes bindable `open` so a test can open/close it.
-->
<script lang="ts">
	import Dialog from '../src/dialog/Dialog.svelte';

	interface Props {
		open?: boolean;
		title?: string;
		description?: string;
		dismissible?: boolean;
	}

	let {
		open = $bindable(false),
		title = 'Delete item',
		description = 'This action cannot be undone.',
		dismissible = true,
	}: Props = $props();
</script>

<button type="button" data-testid="opener" onclick={() => (open = true)}>Open</button>

<Dialog bind:open {title} {description} {dismissible}>
	<p>Are you sure you want to delete this item?</p>
	{#snippet footer()}
		<button type="button" data-testid="cancel" onclick={() => (open = false)}>Cancel</button>
		<button type="button" data-testid="confirm">Delete</button>
	{/snippet}
</Dialog>
