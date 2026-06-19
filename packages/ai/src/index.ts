// @sveltesentio/ai — server-proxy-only LLM client, on-device seam, EU AI Act audit hook.
// See AGENTS.md + ADR-0043 / ADR-0044 / ADR-0045.

export type {
	AiAuditRecord,
	AiAuditEntry,
	AuditClock,
	AuditLog,
	AuditRedactor,
	AuditSink,
	CreateAuditLogOptions,
	RiskTier,
} from './audit.js';
export {
	AiAuditValidationError,
	aiAuditRecordSchema,
	createAuditLog,
	riskTiers,
} from './audit.js';

export type {
	ChatMessage,
	ChatRequest,
	CompleteRequest,
	CreateLlmProxyOptions,
	FetchLike,
	LlmProxy,
} from './proxy.js';
export { createLlmProxy } from './proxy.js';

export type {
	EdgePipeline,
	EdgePipelineFn,
	EdgeTask,
	LoadEdgePipelineOptions,
	TransformersFactory,
	TransformersModule,
} from './edge.js';
export { edgeTasks, loadEdgePipeline } from './edge.js';

export type {
	AnthropicAdapterOptions,
	AnthropicMessageBody,
	AnthropicMessagesLike,
	AnthropicSdkLike,
	AnthropicStreamEvent,
	AuditContext,
	CreateLLMProxyOptions,
	LLMChatParams,
	LLMChunk,
	LLMClient,
	LLMCompletion,
	LLMProxy,
	OllamaSdkLike,
	ProxyClock,
} from './server.js';
export { anthropicAdapter, createLLMProxy, ollamaAdapter } from './server.js';

export type {
	ChatTransport,
	ChatTransportChunk,
	ChatTransportRequest,
	UseLLMChat,
	UseLLMChatOptions,
} from './client.svelte.js';
export { useLLMChat } from './client.svelte.js';
