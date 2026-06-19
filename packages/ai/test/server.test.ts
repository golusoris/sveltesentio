import { describe, expect, it, vi } from 'vitest';
import { ProblemError } from '@sveltesentio/core';
import { createAuditLog, type AiAuditRecord } from '../src/audit.js';
import {
	anthropicAdapter,
	createLLMProxy,
	ollamaAdapter,
	type AnthropicSdkLike,
	type AnthropicStreamEvent,
	type LLMChunk,
	type LLMClient,
	type LLMCompletion,
	type OllamaSdkLike,
	type ProxyClock,
} from '../src/server.js';

/** A deterministic clock: each `now()` reads the next scripted tick. */
function scriptedClock(ticks: readonly number[]): ProxyClock {
	let i = 0;
	return { now: () => ticks[Math.min(i++, ticks.length - 1)]! };
}

/** A fake provider client driven entirely from the test (no network/keys). */
function fakeClient(overrides: Partial<LLMClient> = {}): LLMClient {
	return {
		complete: async (): Promise<LLMCompletion> => ({ text: 'ok', model: 'fake' }),
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator default
		stream: async function* (): AsyncIterable<LLMChunk> {
			yield { text: 'ok' };
		},
		...overrides,
	};
}

describe('createLLMProxy', () => {
	it('forwards complete() to the injected client and returns its result', async () => {
		const complete = vi.fn(
			async (): Promise<LLMCompletion> => ({ text: 'hello there', model: 'claude' }),
		);
		const proxy = createLLMProxy({ client: fakeClient({ complete }) });

		const result = await proxy.complete({
			model: 'claude-opus-4-8',
			messages: [{ role: 'user', content: 'hi' }],
		});

		expect(result).toEqual({ text: 'hello there', model: 'claude' });
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it('streams text deltas from the injected client in order', async () => {
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const stream = async function* (): AsyncIterable<LLMChunk> {
			yield { text: 'Hel' };
			yield { text: 'lo' };
		};
		const proxy = createLLMProxy({ client: fakeClient({ stream }) });

		const chunks: string[] = [];
		for await (const chunk of proxy.stream({
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
		})) {
			chunks.push(chunk.text);
		}

		expect(chunks).toEqual(['Hel', 'lo']);
	});

	it('writes one audit record on a successful completion (model + output + latency)', async () => {
		const written: AiAuditRecord[] = [];
		const audit = createAuditLog({
			sink: (r) => void written.push(r),
			clock: { now: () => new Date('2026-06-14T00:00:00.000Z') },
			idFactory: () => 'audit-1',
		});
		const proxy = createLLMProxy({
			client: fakeClient({
				complete: async () => ({ text: 'answer', model: 'claude-opus-4-8' }),
			}),
			audit,
			clock: scriptedClock([1000, 1320]),
		});

		await proxy.complete(
			{ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'q' }] },
			{ purpose: 'support', humanOverride: false, promptHash: 'sha256:q' },
		);

		expect(written).toHaveLength(1);
		expect(written[0]).toMatchObject({
			model: 'claude-opus-4-8',
			output: 'answer',
			latencyMs: 320,
			purpose: 'support',
			humanOverride: false,
		});
	});

	it('writes one audit record after a stream completes, with the assembled output', async () => {
		const written: AiAuditRecord[] = [];
		const audit = createAuditLog({
			sink: (r) => void written.push(r),
			clock: { now: () => new Date('2026-06-14T00:00:00.000Z') },
			idFactory: () => 'audit-2',
		});
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const stream = async function* (): AsyncIterable<LLMChunk> {
			yield { text: 'a' };
			yield { text: 'b' };
			yield { text: 'c' };
		};
		const proxy = createLLMProxy({
			client: fakeClient({ stream }),
			audit,
			clock: scriptedClock([0, 50]),
		});

		const out: string[] = [];
		for await (const chunk of proxy.stream(
			{ model: 'llama3.1', messages: [{ role: 'user', content: 'q' }] },
			{ purpose: 'chat', humanOverride: false, promptHash: 'sha256:q' },
		)) {
			out.push(chunk.text);
		}

		expect(out.join('')).toBe('abc');
		expect(written).toHaveLength(1);
		expect(written[0]).toMatchObject({ model: 'llama3.1', output: 'abc', latencyMs: 50 });
	});

	it('does NOT write an audit record when no audit context is supplied', async () => {
		const sink = vi.fn();
		const audit = createAuditLog({ sink });
		const proxy = createLLMProxy({ client: fakeClient(), audit });

		await proxy.complete({ model: 'm', messages: [] });

		expect(sink).not.toHaveBeenCalled();
	});

	it('does NOT write an audit record when the configured proxy has no audit log', async () => {
		// Audit context is given but the proxy has no `audit` — record() is a no-op.
		const proxy = createLLMProxy({ client: fakeClient() });
		await expect(
			proxy.complete(
				{ model: 'm', messages: [] },
				{ purpose: 'p', humanOverride: false, promptHash: 'h' },
			),
		).resolves.toMatchObject({ text: 'ok' });
	});

	it('wraps a thrown provider error from complete() as a ProblemError', async () => {
		const proxy = createLLMProxy({
			client: fakeClient({
				complete: async () => {
					throw new Error('upstream down');
				},
			}),
		});

		const error = await proxy
			.complete({ model: 'claude-opus-4-8', messages: [] })
			.then(() => undefined)
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ProblemError);
		if (error instanceof ProblemError) {
			expect(error.status).toBe(502);
			expect(error.detail).toBe('upstream down');
			expect(error.extensions.model).toBe('claude-opus-4-8');
		}
	});

	it('passes a ProblemError from the client through unchanged', async () => {
		const original = new ProblemError({
			type: 'https://errors.example/quota',
			title: 'Quota exceeded',
			status: 429,
		});
		const proxy = createLLMProxy({
			client: fakeClient({
				complete: async () => {
					throw original;
				},
			}),
		});

		await expect(proxy.complete({ model: 'm', messages: [] })).rejects.toBe(original);
	});

	it('wraps a thrown provider error mid-stream as a ProblemError and skips the audit', async () => {
		const sink = vi.fn();
		const audit = createAuditLog({ sink });
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const stream = async function* (): AsyncIterable<LLMChunk> {
			yield { text: 'partial' };
			throw new Error('stream broke');
		};
		const proxy = createLLMProxy({ client: fakeClient({ stream }), audit });

		const seen: string[] = [];
		const error = await (async () => {
			try {
				for await (const chunk of proxy.stream(
					{ model: 'm', messages: [] },
					{ purpose: 'p', humanOverride: false, promptHash: 'h' },
				)) {
					seen.push(chunk.text);
				}
				return undefined;
			} catch (e: unknown) {
				return e;
			}
		})();

		expect(seen).toEqual(['partial']);
		expect(error).toBeInstanceOf(ProblemError);
		expect(sink).not.toHaveBeenCalled();
	});
});

describe('anthropicAdapter', () => {
	function fakeAnthropic(
		create: AnthropicSdkLike['messages']['create'],
		stream: AnthropicSdkLike['messages']['stream'],
	): AnthropicSdkLike {
		return { messages: { create, stream } };
	}

	it('maps roles, hoists the system turn, and joins text blocks on complete()', async () => {
		let seen: Parameters<AnthropicSdkLike['messages']['create']>[0] | undefined;
		const sdk = fakeAnthropic(
			async (body) => {
				seen = body;
				return {
					model: 'claude-opus-4-8',
					content: [
						{ type: 'text', text: 'Hello ' },
						{ type: 'thinking', text: 'IGNORE' },
						{ type: 'text', text: 'world' },
					],
				};
			},
			// eslint-disable-next-line @typescript-eslint/require-await -- unused here
			async function* () {
				/* not used */
			},
		);
		const client = anthropicAdapter(sdk, { defaultMaxTokens: 256 });

		const result = await client.complete({
			model: 'claude-opus-4-8',
			messages: [
				{ role: 'system', content: 'be terse' },
				{ role: 'user', content: 'hi' },
			],
		});

		expect(result).toEqual({ text: 'Hello world', model: 'claude-opus-4-8' });
		expect(seen?.system).toBe('be terse');
		expect(seen?.max_tokens).toBe(256);
		expect(seen?.messages).toEqual([{ role: 'user', content: 'hi' }]);
	});

	it('prefers an explicit system param over a system message', async () => {
		let seen: Parameters<AnthropicSdkLike['messages']['create']>[0] | undefined;
		const sdk = fakeAnthropic(
			async (body) => {
				seen = body;
				return { content: [{ type: 'text', text: 'x' }] };
			},
			// eslint-disable-next-line @typescript-eslint/require-await
			async function* () {},
		);
		const client = anthropicAdapter(sdk);
		await client.complete({
			model: 'm',
			system: 'explicit',
			messages: [{ role: 'system', content: 'message-system' }],
		});
		expect(seen?.system).toBe('explicit');
		expect(seen?.max_tokens).toBe(1024);
	});

	it('yields only text_delta content_block_delta events on stream()', async () => {
		// eslint-disable-next-line @typescript-eslint/require-await -- async generator
		const stream: AnthropicSdkLike['messages']['stream'] = async function* (): AsyncIterable<AnthropicStreamEvent> {
			yield { type: 'message_start' };
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } };
			yield { type: 'content_block_delta', delta: { type: 'input_json_delta', text: 'NO' } };
			yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } };
			yield { type: 'message_stop' };
		};
		const sdk = fakeAnthropic(async () => ({ content: [] }), stream);
		const client = anthropicAdapter(sdk);

		const out: string[] = [];
		for await (const chunk of client.stream({
			model: 'claude-opus-4-8',
			maxTokens: 64,
			messages: [{ role: 'user', content: 'hi' }],
		})) {
			out.push(chunk.text);
		}

		expect(out).toEqual(['Hel', 'lo']);
	});
});

describe('ollamaAdapter', () => {
	it('prepends the system message and returns content on complete()', async () => {
		let seen: Parameters<OllamaSdkLike['chat']>[0] | undefined;
		const sdk: OllamaSdkLike = {
			chat: async (body) => {
				seen = body;
				return { model: 'llama3.1', message: { content: 'pong' } };
			},
		};
		const client = ollamaAdapter(sdk);

		const result = await client.complete({
			model: 'llama3.1',
			system: 'be brief',
			messages: [{ role: 'user', content: 'ping' }],
		});

		expect(result).toEqual({ text: 'pong', model: 'llama3.1' });
		expect(seen?.stream).toBe(false);
		expect(seen?.messages).toEqual([
			{ role: 'system', content: 'be brief' },
			{ role: 'user', content: 'ping' },
		]);
	});

	it('falls back to the requested model when the response omits one', async () => {
		const sdk: OllamaSdkLike = {
			chat: async () => ({ message: { content: 'x' } }),
		};
		const client = ollamaAdapter(sdk);
		const result = await client.complete({ model: 'mistral', messages: [] });
		expect(result.model).toBe('mistral');
	});

	it('throws a ProblemError if a non-streaming call returns a stream', async () => {
		const sdk: OllamaSdkLike = {
			// eslint-disable-next-line @typescript-eslint/require-await -- async generator
			chat: async () =>
				(async function* () {
					yield { message: { content: 'oops' } };
				})(),
		};
		const client = ollamaAdapter(sdk);
		await expect(client.complete({ model: 'm', messages: [] })).rejects.toBeInstanceOf(
			ProblemError,
		);
	});

	it('yields each streamed chunk on stream()', async () => {
		const sdk: OllamaSdkLike = {
			// eslint-disable-next-line @typescript-eslint/require-await -- async generator
			chat: async () =>
				(async function* () {
					yield { message: { content: 'a' } };
					yield { message: { content: '' } };
					yield { message: { content: 'b' }, done: true };
				})(),
		};
		const client = ollamaAdapter(sdk);

		const out: string[] = [];
		for await (const chunk of client.stream({
			model: 'llama3.1',
			messages: [{ role: 'user', content: 'hi' }],
		})) {
			out.push(chunk.text);
		}
		expect(out).toEqual(['a', 'b']);
	});

	it('yields the single message when a streaming call returns a non-stream', async () => {
		const sdk: OllamaSdkLike = {
			chat: async () => ({ message: { content: 'whole' } }),
		};
		const client = ollamaAdapter(sdk);
		const out: string[] = [];
		for await (const chunk of client.stream({ model: 'm', messages: [] })) {
			out.push(chunk.text);
		}
		expect(out).toEqual(['whole']);
	});
});
