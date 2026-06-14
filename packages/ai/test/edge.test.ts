import { describe, expect, it, vi } from 'vitest';
import {
	edgeTasks,
	loadEdgePipeline,
	type TransformersFactory,
	type TransformersModule,
} from '../src/edge.js';

describe('loadEdgePipeline', () => {
	it('loads a pipeline through the injected factory and runs inference', async () => {
		const pipelineFn = vi.fn(async (input: unknown) => ({ label: 'POSITIVE', input }));
		const pipeline = vi.fn(async () => pipelineFn);
		const factory: TransformersFactory = async () =>
			({ pipeline } satisfies TransformersModule);

		const handle = await loadEdgePipeline('text-classification', {
			model: 'Xenova/distilbert-base-uncased',
			factory,
			pipelineOptions: { device: 'webgpu' },
		});

		expect(handle.task).toBe('text-classification');
		expect(handle.model).toBe('Xenova/distilbert-base-uncased');
		expect(pipeline).toHaveBeenCalledWith(
			'text-classification',
			'Xenova/distilbert-base-uncased',
			{ device: 'webgpu' },
		);

		const out = await handle.run('great product', { topk: 1 });
		expect(out).toEqual({ label: 'POSITIVE', input: 'great product' });
		expect(pipelineFn).toHaveBeenCalledWith('great product', { topk: 1 });
	});

	it('passes undefined model when none is supplied', async () => {
		const pipeline = vi.fn(async () => async () => [0.1, 0.2]);
		const factory: TransformersFactory = async () => ({ pipeline });
		const handle = await loadEdgePipeline('feature-extraction', { factory });
		expect(handle.model).toBeUndefined();
		expect(pipeline).toHaveBeenCalledWith('feature-extraction', undefined, undefined);
		await expect(handle.run('vectorise me')).resolves.toEqual([0.1, 0.2]);
	});

	it('propagates a factory load failure (optional peer missing)', async () => {
		const factory: TransformersFactory = async () => {
			throw new Error("Cannot find module '@huggingface/transformers'");
		};
		await expect(loadEdgePipeline('summarization', { factory })).rejects.toThrow(
			/@huggingface\/transformers/,
		);
	});

	it('exposes the supported task list', () => {
		expect(edgeTasks).toContain('feature-extraction');
		expect(edgeTasks).toContain('automatic-speech-recognition');
	});
});
