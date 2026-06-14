/**
 * On-device (in-browser) inference seam (ADR-0044). `@huggingface/transformers`
 * is heavy (tens to hundreds of MB of models) and OPTIONAL — it is loaded via a
 * dynamic-import factory so it never enters the bundle unless actually used.
 * `@xenova/transformers` is deprecated; do not import it.
 */

/** Tasks the on-device seam exposes (subset of the transformers pipeline tasks). */
export const edgeTasks = [
	'feature-extraction',
	'text-classification',
	'token-classification',
	'zero-shot-classification',
	'translation',
	'summarization',
	'automatic-speech-recognition',
] as const;
export type EdgeTask = (typeof edgeTasks)[number];

/**
 * The callable a `pipeline(task, model)` returns. Kept structural so we don't
 * hard-depend on the transformers type surface.
 */
export type EdgePipelineFn = (input: unknown, options?: unknown) => Promise<unknown>;

/** The single symbol we use from `@huggingface/transformers`. */
export interface TransformersModule {
	pipeline(task: string, model?: string, options?: unknown): Promise<EdgePipelineFn>;
}

/** Factory that yields the transformers module — defaults to a dynamic import. */
export type TransformersFactory = () => Promise<TransformersModule>;

export interface LoadEdgePipelineOptions {
	/** Optional model id (HF hub or self-hosted); the pipeline default is used if omitted. */
	model?: string | undefined;
	/** Injectable module factory (tests pass a stub; prod defaults to dynamic import). */
	factory?: TransformersFactory | undefined;
	/** Options forwarded to `pipeline(task, model, options)` (e.g. `{ device: 'webgpu' }`). */
	pipelineOptions?: unknown;
}

/** A typed wrapper around a loaded on-device pipeline. */
export interface EdgePipeline<Input = unknown, Output = unknown> {
	readonly task: EdgeTask;
	readonly model: string | undefined;
	run(input: Input, options?: unknown): Promise<Output>;
}

const defaultFactory: TransformersFactory = async () => {
	// Dynamic, optional: the module is a peer dependency and may be absent.
	const mod: unknown = await import(
		/* @vite-ignore */ '@huggingface/transformers'
	);
	return mod as TransformersModule;
};

/**
 * Load an on-device inference pipeline (ADR-0044). The transformers module is
 * resolved lazily through `factory` (defaulting to a dynamic import), so the
 * heavy dependency stays out of any bundle that never calls this.
 */
export async function loadEdgePipeline<Input = unknown, Output = unknown>(
	task: EdgeTask,
	options: LoadEdgePipelineOptions = {},
): Promise<EdgePipeline<Input, Output>> {
	const factory = options.factory ?? defaultFactory;
	const transformers = await factory();
	const fn = await transformers.pipeline(task, options.model, options.pipelineOptions);
	return {
		task,
		model: options.model,
		async run(input: Input, runOptions?: unknown): Promise<Output> {
			return (await fn(input, runOptions)) as Output;
		},
	};
}
