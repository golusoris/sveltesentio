import { describe, expect, it } from 'vitest';
import {
	useLLMChat,
	type ChatTransport,
	type ChatTransportChunk,
} from '../src/client.svelte.js';

/**
 * `client.svelte.ts` is a rune module compiled by the `svelteRunes` Vite plugin
 * (vitest.config.ts) into real `svelte/internal/client` output, so `$state`
 * reassignment is observed through the getters — reactivity is genuine, not a
 * pass-by-value shim. Tests drive the chat through an injected transport (an
 * async generator), so no network or keys are involved.
 */

/** A transport that yields a fixed sequence of text deltas. */
function fixedTransport(...deltas: string[]): ChatTransport {
	// eslint-disable-next-line @typescript-eslint/require-await -- async generator
	return async function* (): AsyncIterable<ChatTransportChunk> {
		for (const text of deltas) yield { text };
	};
}

describe('useLLMChat', () => {
	it('starts empty (or with the seeded messages) and not streaming', () => {
		const chat = useLLMChat({ transport: fixedTransport() });
		expect(chat.messages).toEqual([]);
		expect(chat.streaming).toBe(false);
		expect(chat.error).toBeUndefined();
	});

	it('seeds the conversation from initialMessages', () => {
		const chat = useLLMChat({
			transport: fixedTransport(),
			initialMessages: [{ role: 'system', content: 'be terse' }],
		});
		expect(chat.messages).toEqual([{ role: 'system', content: 'be terse' }]);
	});

	it('appends the user message and streams the assistant reply', async () => {
		const chat = useLLMChat({ transport: fixedTransport('Hel', 'lo') });

		await chat.send('hi');

		expect(chat.messages).toEqual([
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'Hello' },
		]);
		expect(chat.streaming).toBe(false);
	});

	it('passes only the prior turns (not the empty reply slot) to the transport', async () => {
		let seen: readonly { role: string; content: string }[] = [];
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const transport: ChatTransport = async function* (request) {
			seen = request.messages.map((m) => ({ role: m.role, content: m.content }));
			yield { text: 'ok' };
		};
		const chat = useLLMChat({
			transport,
			initialMessages: [{ role: 'system', content: 'sys' }],
		});

		await chat.send('question');

		expect(seen).toEqual([
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'question' },
		]);
	});

	it('captures a transport error and clears the streaming flag', async () => {
		// eslint-disable-next-line @typescript-eslint/require-await, require-yield -- throwing generator
		const transport: ChatTransport = async function* () {
			throw new Error('stream failed');
		};
		const chat = useLLMChat({ transport });

		await chat.send('hi');

		expect(chat.streaming).toBe(false);
		expect(chat.error).toBeInstanceOf(Error);
		expect((chat.error as Error).message).toBe('stream failed');
	});

	it('clears a prior error on the next send', async () => {
		let fail = true;
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const transport: ChatTransport = async function* () {
			if (fail) {
				fail = false;
				throw new Error('first failed');
			}
			yield { text: 'recovered' };
		};
		const chat = useLLMChat({ transport });

		await chat.send('a');
		expect(chat.error).toBeInstanceOf(Error);

		await chat.send('b');
		expect(chat.error).toBeUndefined();
		expect(chat.messages.at(-1)).toEqual({ role: 'assistant', content: 'recovered' });
	});

	it('is a no-op when send() is called while already streaming', async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const transport: ChatTransport = async function* () {
			await gate;
			yield { text: 'done' };
		};
		const chat = useLLMChat({ transport });

		const first = chat.send('first');
		expect(chat.streaming).toBe(true);

		// Second send is rejected while the first is in flight.
		await chat.send('second');
		expect(chat.messages).toHaveLength(2); // only the first user+reply pair

		release?.();
		await first;
		expect(chat.streaming).toBe(false);
	});

	it('stop() aborts the in-flight stream and clears the streaming flag', async () => {
		let abortedSignal: AbortSignal | undefined;
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const transport: ChatTransport = async function* (request) {
			abortedSignal = request.signal;
			await gate;
			yield { text: 'late' };
		};
		const chat = useLLMChat({ transport });

		const pending = chat.send('hi');
		expect(chat.streaming).toBe(true);

		chat.stop();
		expect(chat.streaming).toBe(false);
		expect(abortedSignal?.aborted).toBe(true);

		release?.();
		await pending;
	});

	it('reset() restores the seeded messages and clears state', async () => {
		const chat = useLLMChat({
			transport: fixedTransport('reply'),
			initialMessages: [{ role: 'system', content: 'sys' }],
		});

		await chat.send('hi');
		expect(chat.messages).toHaveLength(3);

		chat.reset();
		expect(chat.messages).toEqual([{ role: 'system', content: 'sys' }]);
		expect(chat.error).toBeUndefined();
		expect(chat.streaming).toBe(false);
	});
});
