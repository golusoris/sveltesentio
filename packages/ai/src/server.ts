/**
 * Server-only LLM proxy (ADR-0043). This module is the seam your `+server.ts`
 * route imports — it wraps a provider SDK (`@anthropic-ai/sdk` or `ollama-js`)
 * behind an injectable client so neither the SDK nor any API key reaches the
 * browser, and so it unit-tests with fakes (no network, no keys).
 *
 * Providers are passed in by construction (`createLLMProxy({ client })`); the
 * thin adapters below (`anthropicAdapter`, `ollamaAdapter`) translate a
 * provider's SDK surface into the {@link LLMClient} contract this proxy speaks.
 * The heavy SDKs are OPTIONAL peers — the adapters take an already-constructed
 * SDK instance, so importing this module never imports a provider SDK.
 */
import { ProblemError } from '@sveltesentio/core';
import type { ChatMessage } from './proxy.js';
import type { AuditLog, AiAuditEntry } from './audit.js';

/** A single completion request handed to the underlying provider client. */
export interface LLMChatParams {
	/** Provider model id, e.g. `claude-opus-4-8` or `llama3.1`. */
	model: string;
	messages: readonly ChatMessage[];
	/** Upper bound on generated tokens; the client may clamp to the model's max. */
	maxTokens?: number | undefined;
	/** System prompt, when the provider models it separately from `messages`. */
	system?: string | undefined;
	/** Cooperative cancellation forwarded to the provider call. */
	signal?: AbortSignal | undefined;
}

/** One streamed text chunk. Providers emit many of these per completion. */
export interface LLMChunk {
	/** Incremental text delta. */
	text: string;
}

/** The complete, non-streamed result of a completion. */
export interface LLMCompletion {
	/** Full assistant text (the concatenation of every streamed delta). */
	text: string;
	/** Model that actually served the request, as reported by the provider. */
	model: string;
}

/**
 * The provider contract the proxy speaks. An adapter wraps a real SDK instance
 * into this shape; a fake implements it directly for tests. Both `complete` and
 * `stream` are required so the proxy can serve non-streaming and SSE callers.
 */
export interface LLMClient {
	/** Run a completion to the end and return the full text. */
	complete(params: LLMChatParams): Promise<LLMCompletion>;
	/** Run a completion, yielding text deltas as they arrive (SSE-friendly). */
	stream(params: LLMChatParams): AsyncIterable<LLMChunk>;
}

/**
 * Audit context the consumer supplies per request. The proxy stamps
 * `model`/`output`/`latencyMs` itself; everything here is the consumer's
 * traceability metadata (EU AI Act Art. 12 — see {@link AuditLog}).
 */
export type AuditContext = Omit<
	AiAuditEntry,
	'model' | 'output' | 'outputHash' | 'latencyMs'
>;

/** Minimal clock seam so latency is deterministic under test (ADR-0052). */
export interface ProxyClock {
	now(): number;
}

const defaultClock: ProxyClock = { now: () => Date.now() };

export interface CreateLLMProxyOptions {
	/** Injected provider client (an adapter or a fake). NEVER imports an SDK here. */
	client: LLMClient;
	/**
	 * Optional audit log (ADR-0045). When present, every completion writes one
	 * audit record on success; a failed inference is NOT recorded (the consumer
	 * sees the thrown {@link ProblemError} instead).
	 */
	audit?: AuditLog | undefined;
	/** Injectable clock for the latency measurement; defaults to wall-clock. */
	clock?: ProxyClock | undefined;
}

export interface LLMProxy {
	/** Complete a request, optionally writing an audit record on success. */
	complete(
		params: LLMChatParams,
		audit?: AuditContext,
	): Promise<LLMCompletion>;
	/**
	 * Stream a request as text deltas. The full text is assembled internally so a
	 * single audit record can be written once the stream completes.
	 */
	stream(params: LLMChatParams, audit?: AuditContext): AsyncIterable<LLMChunk>;
}

/** Wrap an arbitrary provider/transport error as an RFC 9457 {@link ProblemError}. */
function toProblem(error: unknown, model: string): ProblemError {
	if (error instanceof ProblemError) return error;
	const detail = error instanceof Error ? error.message : String(error);
	return new ProblemError({
		type: 'about:blank',
		title: 'LLM provider error',
		status: 502,
		detail,
		extensions: { model },
	});
}

/**
 * Build a server-only LLM proxy over an injected provider client (ADR-0043).
 * The proxy owns audit emission and latency timing; the client owns the
 * provider call. Errors from the client are normalised to {@link ProblemError}.
 */
export function createLLMProxy(options: CreateLLMProxyOptions): LLMProxy {
	const clock = options.clock ?? defaultClock;

	async function record(
		audit: AuditContext | undefined,
		model: string,
		output: string,
		latencyMs: number,
	): Promise<void> {
		if (!options.audit || !audit) return;
		await options.audit.record({
			...audit,
			model,
			output,
			latencyMs,
		});
	}

	return {
		async complete(
			params: LLMChatParams,
			audit?: AuditContext,
		): Promise<LLMCompletion> {
			const start = clock.now();
			let result: LLMCompletion;
			try {
				result = await options.client.complete(params);
			} catch (error) {
				throw toProblem(error, params.model);
			}
			await record(audit, result.model, result.text, clock.now() - start);
			return result;
		},

		async *stream(
			params: LLMChatParams,
			audit?: AuditContext,
		): AsyncIterable<LLMChunk> {
			const start = clock.now();
			let assembled = '';
			try {
				for await (const chunk of options.client.stream(params)) {
					assembled += chunk.text;
					yield chunk;
				}
			} catch (error) {
				throw toProblem(error, params.model);
			}
			await record(audit, params.model, assembled, clock.now() - start);
		},
	};
}

// ---------------------------------------------------------------------------
// Provider adapters — structural over the SDKs so importing this file never
// imports `@anthropic-ai/sdk` or `ollama-js`. The consumer constructs the real
// SDK instance and passes it in; tests pass a structural fake.
// ---------------------------------------------------------------------------

/** The body shape both Anthropic message calls accept. Kept structural. */
export interface AnthropicMessageBody {
	model: string;
	max_tokens: number;
	system?: string | undefined;
	messages: { role: 'user' | 'assistant'; content: string }[];
	stream?: boolean | undefined;
}

/** The slice of `@anthropic-ai/sdk` the adapter calls. Kept structural. */
export interface AnthropicMessagesLike {
	create(body: AnthropicMessageBody): Promise<{
		model?: string;
		content: { type: string; text?: string }[];
	}>;
	stream(body: AnthropicMessageBody): AsyncIterable<AnthropicStreamEvent>;
}

/** The streaming events the adapter consumes (text deltas only). */
export interface AnthropicStreamEvent {
	type: string;
	delta?: { type: string; text?: string };
}

export interface AnthropicSdkLike {
	messages: AnthropicMessagesLike;
}

export interface AnthropicAdapterOptions {
	/** Default `max_tokens` when a request omits it. */
	defaultMaxTokens?: number | undefined;
}

/** Map our roles onto Anthropic's user/assistant turns; `system` is hoisted out. */
function toAnthropicMessages(
	messages: readonly ChatMessage[],
): { role: 'user' | 'assistant'; content: string }[] {
	return messages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.map((m) => ({
			role: m.role === 'assistant' ? 'assistant' : 'user',
			content: m.content,
		}));
}

/** Pull a leading system turn out of `messages`, preferring an explicit `system`. */
function resolveSystem(
	params: LLMChatParams,
): string | undefined {
	if (params.system !== undefined) return params.system;
	const sys = params.messages.find((m) => m.role === 'system');
	return sys?.content;
}

/**
 * Adapt an already-constructed `@anthropic-ai/sdk` client to {@link LLMClient}.
 * The SDK instance is injected — this function never imports the SDK, so the
 * peer stays out of any bundle that does not call it.
 */
export function anthropicAdapter(
	sdk: AnthropicSdkLike,
	options: AnthropicAdapterOptions = {},
): LLMClient {
	const fallbackMax = options.defaultMaxTokens ?? 1024;

	return {
		async complete(params: LLMChatParams): Promise<LLMCompletion> {
			const response = await sdk.messages.create({
				model: params.model,
				max_tokens: params.maxTokens ?? fallbackMax,
				...(resolveSystem(params) !== undefined
					? { system: resolveSystem(params) }
					: {}),
				messages: toAnthropicMessages(params.messages),
			});
			const text = response.content
				.filter((b) => b.type === 'text')
				.map((b) => b.text ?? '')
				.join('');
			return { text, model: response.model ?? params.model };
		},

		async *stream(params: LLMChatParams): AsyncIterable<LLMChunk> {
			const events = sdk.messages.stream({
				model: params.model,
				max_tokens: params.maxTokens ?? fallbackMax,
				...(resolveSystem(params) !== undefined
					? { system: resolveSystem(params) }
					: {}),
				messages: toAnthropicMessages(params.messages),
			});
			for await (const event of events) {
				if (
					event.type === 'content_block_delta' &&
					event.delta?.type === 'text_delta' &&
					event.delta.text
				) {
					yield { text: event.delta.text };
				}
			}
		},
	};
}

/** The slice of `ollama-js` the adapter calls. Kept structural. */
export interface OllamaSdkLike {
	chat(body: {
		model: string;
		messages: { role: string; content: string }[];
		stream?: boolean;
	}): Promise<
		| { model?: string; message: { content: string } }
		| AsyncIterable<{ message: { content: string }; done?: boolean }>
	>;
}

/**
 * Adapt an already-constructed `ollama-js` client to {@link LLMClient}. As with
 * the Anthropic adapter, the SDK instance is injected so this module imports no
 * provider SDK. Ollama is server-proxy-only — never call it from the browser
 * (no CORS/auth by default; ADR-0043).
 */
export function ollamaAdapter(sdk: OllamaSdkLike): LLMClient {
	function toOllamaMessages(
		messages: readonly ChatMessage[],
		system: string | undefined,
	): { role: string; content: string }[] {
		const out: { role: string; content: string }[] = [];
		if (system !== undefined) out.push({ role: 'system', content: system });
		for (const m of messages) out.push({ role: m.role, content: m.content });
		return out;
	}

	return {
		async complete(params: LLMChatParams): Promise<LLMCompletion> {
			const response = await sdk.chat({
				model: params.model,
				messages: toOllamaMessages(params.messages, params.system),
				stream: false,
			});
			if (Symbol.asyncIterator in response) {
				throw new ProblemError({
					type: 'about:blank',
					title: 'Unexpected streaming response',
					status: 502,
					detail: 'ollama.chat returned a stream for a non-streaming request',
					extensions: { model: params.model },
				});
			}
			return { text: response.message.content, model: response.model ?? params.model };
		},

		async *stream(params: LLMChatParams): AsyncIterable<LLMChunk> {
			const response = await sdk.chat({
				model: params.model,
				messages: toOllamaMessages(params.messages, params.system),
				stream: true,
			});
			if (!(Symbol.asyncIterator in response)) {
				yield { text: response.message.content };
				return;
			}
			for await (const part of response) {
				if (part.message.content) yield { text: part.message.content };
			}
		},
	};
}
