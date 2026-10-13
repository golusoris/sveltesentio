import { describe, expect, it, vi } from 'vitest';

const { MockFlowCanvas, MockProcessNode, MockDecisionNode, MockDataNode } = vi.hoisted(() => ({
	MockFlowCanvas: () => null,
	MockProcessNode: () => null,
	MockDecisionNode: () => null,
	MockDataNode: () => null,
}));

vi.mock('../src/FlowCanvas.svelte', () => ({
	default: MockFlowCanvas,
}));

vi.mock('../src/nodes/ProcessNode.svelte', () => ({
	default: MockProcessNode,
}));

vi.mock('../src/nodes/DecisionNode.svelte', () => ({
	default: MockDecisionNode,
}));

vi.mock('../src/nodes/DataNode.svelte', () => ({
	default: MockDataNode,
}));

import { FlowCanvas } from '../src/canvas.js';
import { DataNode, DecisionNode, ProcessNode, exampleNodeTypes } from '../src/nodes.js';

describe('canvas exports', () => {
	describe('FlowCanvas', () => {
		it('is exported as the component from the documented sub-export', () => {
			expect(FlowCanvas).toBeDefined();
			expect(FlowCanvas).toBe(MockFlowCanvas);
			expect(typeof FlowCanvas).toBe('function');
		});
	});

	describe('exampleNodeTypes', () => {
		it('has the exact key set of supported custom node types', () => {
			const keys = Object.keys(exampleNodeTypes).sort();
			expect(keys).toEqual(['data', 'decision', 'process']);
		});

		it('maps each key to its corresponding Svelte component', () => {
			expect(exampleNodeTypes.process).toBe(ProcessNode);
			expect(exampleNodeTypes.decision).toBe(DecisionNode);
			expect(exampleNodeTypes.data).toBe(DataNode);

			expect(exampleNodeTypes.process).toBe(MockProcessNode);
			expect(exampleNodeTypes.decision).toBe(MockDecisionNode);
			expect(exampleNodeTypes.data).toBe(MockDataNode);
		});

		it('boundary/negative: unknown node type keys are undefined', () => {
			expect((exampleNodeTypes as Record<string, unknown>)['unknown']).toBeUndefined();
			expect((exampleNodeTypes as Record<string, unknown>)['custom']).toBeUndefined();
			expect(Object.keys(exampleNodeTypes)).not.toContain('unknown');
		});
	});
});
