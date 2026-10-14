<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChatStream from './ChatStream.svelte';
	import { useLLMChat, type ChatTransport, type ChatTransportChunk } from './client.svelte.js';
	import type { ChatMessage } from './proxy.js';

	const STATIC_MESSAGES: readonly ChatMessage[] = [
		{ role: 'user', content: 'What is sveltesentio?' },
		{
			role: 'assistant',
			content:
				'sveltesentio is an enterprise Svelte 5 meta-framework with runes-native reactivity and built-in WCAG 2.2 AA accessibility guarantees.',
		},
	];

	/** A transport that yields a fixed sequence of text chunks without network or timers. */
	function stubTransport(): ChatTransport {
		return async function* (): AsyncIterable<ChatTransportChunk> {
			yield { text: 'Hello! ' };
			yield { text: 'I am streaming ' };
			yield { text: 'via a local async iterable stub.' };
		};
	}

	const { Story } = defineMeta({
		title: 'ai/ChatStream',
		component: ChatStream,
		tags: ['autodocs'],
		argTypes: {
			messages: { control: 'object' },
			streaming: { control: 'boolean' },
			label: { control: 'text' },
			streamingLabel: { control: 'text' },
		},
		args: {
			messages: STATIC_MESSAGES,
		},
	});
</script>

<script lang="ts">
	const streamingChat = useLLMChat({
		transport: stubTransport(),
		initialMessages: [
			{ role: 'user', content: 'Generate a short summary.' },
			{
				role: 'assistant',
				content: 'Streaming chunk-by-chunk...',
			},
		],
	});
</script>

<!-- Static transcript with plain-text turns. -->
<Story name="Static" args={{ messages: STATIC_MESSAGES }} />

<!-- Streaming indicator active with custom status text. -->
<Story
	name="Streaming indicator"
	args={{
		messages: STATIC_MESSAGES,
		streaming: true,
		streamingLabel: 'Generating response…',
	}}
/>

<!-- Streaming via a local async iterable transport stub (no network, no timers). -->
<Story
	name="Streaming stub"
	asChild
	play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const button = canvasElement.querySelector<HTMLButtonElement>('button');
		if (!button) throw new Error('Send button not found');
		button.click();

		const expected = 'Hello! I am streaming via a local async iterable stub.';
		let matched = false;
		for (let i = 0; i < 50; i += 1) {
			const text = canvasElement.textContent ?? '';
			const status = canvasElement.querySelector('[role="status"]');
			if (text.includes(expected) && !status) {
				matched = true;
				break;
			}
			await new Promise((r) => setTimeout(r, 20));
		}

		if (!matched) {
			const text = canvasElement.textContent ?? '';
			const status = canvasElement.querySelector('[role="status"]');
			if (!text.includes(expected)) {
				throw new Error(`Expected canvas text to contain "${expected}"`);
			}
			if (status) {
				throw new Error('Expected no [role="status"] element to remain');
			}
		}
	}}
>
	<div>
		<button type="button" onclick={() => void streamingChat.send('Summarise')}>Send</button>
		<ChatStream messages={streamingChat.messages} streaming={streamingChat.streaming} />
	</div>
</Story>
