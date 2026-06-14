import {
	ProblemError,
	isProblemResponse,
	problemFromResponse,
} from '@sveltesentio/core';

/**
 * A single chat turn. Roles mirror the de-facto provider convention; the proxy
 * does not interpret them — it forwards to the app's own server endpoint.
 */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
}

export interface ChatRequest {
	messages: readonly ChatMessage[];
	/** Optional model hint; the server endpoint may override or ignore it. */
	model?: string | undefined;
	/** Free-form passthrough forwarded verbatim to the server endpoint. */
	metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface CompleteRequest {
	prompt: string;
	model?: string | undefined;
	metadata?: Readonly<Record<string, unknown>> | undefined;
}

/** Minimal `fetch` shape so the proxy can be driven by an injected stub in tests. */
export type FetchLike = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		signal?: AbortSignal;
	},
) => Promise<Response>;

export interface CreateLlmProxyOptions {
	/** App-owned server endpoint (e.g. `/api/ai/chat`). NEVER a provider URL (ADR-0043). */
	endpoint: string;
	/** Injectable fetch; defaults to the global. */
	fetch?: FetchLike | undefined;
	/** Extra headers merged onto every request (e.g. a CSRF token). */
	headers?: Record<string, string> | undefined;
}

export interface LlmProxy {
	/** POST a chat request to the server endpoint and return the parsed JSON body. */
	chat<T = unknown>(request: ChatRequest, init?: { signal?: AbortSignal }): Promise<T>;
	/** POST a single-prompt completion request to the server endpoint. */
	complete<T = unknown>(
		request: CompleteRequest,
		init?: { signal?: AbortSignal },
	): Promise<T>;
}

function resolveFetch(injected: FetchLike | undefined): FetchLike {
	if (injected) return injected;
	const g = (globalThis as { fetch?: FetchLike }).fetch;
	if (!g) {
		throw new ProblemError({
			type: 'about:blank',
			title: 'No fetch implementation',
			status: 500,
			detail: 'createLlmProxy requires a fetch implementation (none on globalThis).',
		});
	}
	return g;
}

async function readBody(response: Response): Promise<unknown> {
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.toLowerCase().includes('json')) {
		try {
			return (await response.json()) as unknown;
		} catch {
			return undefined;
		}
	}
	try {
		return await response.text();
	} catch {
		return undefined;
	}
}

/**
 * Server-proxy-only LLM client (ADR-0043). Provider SDKs and API keys NEVER
 * reach the browser — this client only ever talks to the app's own
 * `+server.ts` endpoint, which proxies the real provider.
 *
 * Non-2xx responses are surfaced as a {@link ProblemError} (RFC 9457): a
 * `application/problem+json` body is parsed into its fields, otherwise a
 * generic problem carrying the status is thrown.
 */
export function createLlmProxy(options: CreateLlmProxyOptions): LlmProxy {
	const fetchImpl = resolveFetch(options.fetch);

	async function post<T>(
		payload: unknown,
		init?: { signal?: AbortSignal },
	): Promise<T> {
		const response = await fetchImpl(options.endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, application/problem+json',
				...options.headers,
			},
			body: JSON.stringify(payload),
			...(init?.signal ? { signal: init.signal } : {}),
		});

		const body = await readBody(response);
		if (!response.ok) {
			if (isProblemResponse(response)) {
				throw problemFromResponse(response, body);
			}
			throw new ProblemError({
				type: 'about:blank',
				title: response.statusText || 'AI proxy error',
				status: response.status,
				detail: typeof body === 'string' ? body : undefined,
				extensions: { endpoint: options.endpoint },
			});
		}
		return body as T;
	}

	return {
		chat<T = unknown>(request: ChatRequest, init?: { signal?: AbortSignal }): Promise<T> {
			return post<T>(request, init);
		},
		complete<T = unknown>(
			request: CompleteRequest,
			init?: { signal?: AbortSignal },
		): Promise<T> {
			return post<T>(request, init);
		},
	};
}
