import { describe, expect, it } from 'vitest';
import { aiAuditRecordSchema, riskTiers } from '../src/audit.js';

describe('riskTiers', () => {
	it('exports the EU AI Act risk tiers in exact order with exact contents', () => {
		expect(riskTiers).toEqual(['minimal', 'limited', 'high', 'unacceptable']);
		expect(riskTiers.length).toBe(4);
		expect(riskTiers[0]).toBe('minimal');
		expect(riskTiers[1]).toBe('limited');
		expect(riskTiers[2]).toBe('high');
		expect(riskTiers[3]).toBe('unacceptable');
	});

	it('accepts every declared risk tier in the aiAuditRecordSchema', () => {
		for (const tier of riskTiers) {
			const record = {
				id: '018f3a2c-7b44-7000-8000-000000000001',
				timestamp: '2026-10-14T00:00:00.000Z',
				model: 'claude-sonnet-4',
				prompt: 'test prompt',
				output: 'test output',
				purpose: 'testing risk tier validation',
				humanOverride: false,
				riskTier: tier,
			};
			const result = aiAuditRecordSchema.safeParse(record);
			expect(result.success).toBe(true);
		}
	});

	it('boundary/negative: rejects unknown or invalid risk tiers', () => {
		const tiersList: readonly string[] = riskTiers;
		expect(tiersList.includes('unknown')).toBe(false);
		expect(tiersList.includes('medium')).toBe(false);
		expect(tiersList.includes('moderate')).toBe(false);
		expect(tiersList.includes('critical')).toBe(false);
		expect(tiersList.includes('extreme')).toBe(false);
		expect(tiersList.includes('')).toBe(false);

		const recordWithInvalidTier = {
			id: '018f3a2c-7b44-7000-8000-000000000002',
			timestamp: '2026-10-14T00:00:00.000Z',
			model: 'claude-sonnet-4',
			prompt: 'test prompt',
			output: 'test output',
			purpose: 'testing invalid tier rejection',
			humanOverride: false,
			riskTier: 'unknown',
		};
		const result = aiAuditRecordSchema.safeParse(recordWithInvalidTier);
		expect(result.success).toBe(false);
	});
});
