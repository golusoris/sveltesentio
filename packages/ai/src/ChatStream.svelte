<!--
@component
ChatStream — a thin, accessible transcript for a streaming chat. Renders the
`messages` from `useLLMChat()` (or any `{ role, content }[]`) as a labelled log
region. The in-flight assistant reply is announced politely via `aria-live`, and
a busy indicator reflects the `streaming` flag.

Presentation only — it owns no transport and no network. The parent passes
`messages` + `streaming` (typically spread straight from `useLLMChat`).

WCAG 2.2 AA:
- The transcript is a labelled `role="log"` with `aria-live="polite"`.
- Each turn is labelled by its role so screen readers announce who spoke.
- The streaming indicator carries `role="status"` so it is announced without
  stealing focus.

Plain `tsc` does not type-check `.svelte`; the streamed state lives in the
runes-tested `./client` module.
-->
<script lang="ts">
	import type { ChatMessage } from './proxy.js';

	interface Props {
		/** Conversation to render, oldest first. */
		messages: readonly ChatMessage[];
		/** Whether a reply is currently streaming; drives the busy indicator. */
		streaming?: boolean;
		/** Accessible name for the transcript region. */
		label?: string;
		/** Copy for the streaming indicator. */
		streamingLabel?: string;
		/** Visible name per role; apps localise here. */
		roleLabels?: Partial<Record<ChatMessage['role'], string>>;
	}

	const DEFAULT_ROLE_LABELS: Record<ChatMessage['role'], string> = {
		system: 'System',
		user: 'You',
		assistant: 'Assistant',
		tool: 'Tool',
	};

	const {
		messages,
		streaming = false,
		label = 'Conversation',
		streamingLabel = 'Assistant is responding…',
		roleLabels,
	}: Props = $props();

	const labels = $derived({ ...DEFAULT_ROLE_LABELS, ...roleLabels });
</script>

<section class="ssentio-chat" aria-label={label} role="log" aria-live="polite">
	<ol class="ssentio-chat__log">
		{#each messages as message, index (index)}
			<li class="ssentio-chat__turn" data-role={message.role}>
				<span class="ssentio-chat__role">{labels[message.role]}</span>
				<p class="ssentio-chat__content">{message.content}</p>
			</li>
		{/each}
	</ol>

	{#if streaming}
		<p class="ssentio-chat__status" role="status">{streamingLabel}</p>
	{/if}
</section>

<style>
	.ssentio-chat {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ssentio-chat__log {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.ssentio-chat__turn {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.ssentio-chat__role {
		font-size: 0.75rem;
		font-weight: 600;
		opacity: 0.7;
	}

	.ssentio-chat__content {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.ssentio-chat__turn[data-role='user'] {
		align-items: flex-end;
		text-align: end;
	}

	.ssentio-chat__status {
		margin: 0;
		font-size: 0.875rem;
		opacity: 0.8;
	}
</style>
