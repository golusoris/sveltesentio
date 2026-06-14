import { describe, expect, it, vi } from 'vitest';
import {
	AiAuditValidationError,
	aiAuditRecordSchema,
	createAuditLog,
	type AiAuditEntry,
	type AiAuditRecord,
	type AuditClock,
} from '../src/audit.js';

const fixedClock: AuditClock = { now: () => new Date('2026-06-14T12:00:00.000Z') };

function baseEntry(overrides: Partial<AiAuditEntry> = {}): AiAuditEntry {
	return {
		model: 'claude-sonnet-4',
		promptHash: 'sha256:abc',
		outputHash: 'sha256:def',
		purpose: 'support-triage',
		humanOverride: false,
		...overrides,
	};
}

describe('aiAuditRecordSchema', () => {
	it('accepts a full valid record', () => {
		const record: AiAuditRecord = {
			id: '0190a000-0000-7000-8000-000000000000',
			timestamp: '2026-06-14T12:00:00.000Z',
			model: 'claude-sonnet-4',
			prompt: 'hello',
			output: 'hi',
			userId: 'user-42',
			purpose: 'chat',
			humanOverride: true,
			latencyMs: 320,
			riskTier: 'high',
			disclosureShown: true,
			metadata: { traceId: 'abc' },
		};
		expect(aiAuditRecordSchema.safeParse(record).success).toBe(true);
	});

	it('rejects a record missing both prompt and promptHash', () => {
		const result = aiAuditRecordSchema.safeParse({
			id: 'x',
			timestamp: '2026-06-14T12:00:00.000Z',
			model: 'm',
			outputHash: 'h',
			purpose: 'p',
			humanOverride: false,
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.includes('prompt'))).toBe(true);
		}
	});

	it('rejects a non-ISO timestamp', () => {
		const result = aiAuditRecordSchema.safeParse(
			baseEntry({ id: 'x', timestamp: 'not-a-date' } as Partial<AiAuditRecord>),
		);
		expect(result.success).toBe(false);
	});

	it('rejects an unknown risk tier', () => {
		const result = aiAuditRecordSchema.safeParse({
			id: 'x',
			timestamp: '2026-06-14T12:00:00.000Z',
			model: 'm',
			promptHash: 'h',
			outputHash: 'h',
			purpose: 'p',
			humanOverride: false,
			riskTier: 'catastrophic',
		});
		expect(result.success).toBe(false);
	});
});

describe('createAuditLog', () => {
	it('stamps the timestamp via the injected clock and an id via idFactory', async () => {
		const written: AiAuditRecord[] = [];
		const log = createAuditLog({
			sink: (r) => void written.push(r),
			clock: fixedClock,
			idFactory: () => 'fixed-id',
		});

		const record = await log.record(baseEntry());

		expect(record.id).toBe('fixed-id');
		expect(record.timestamp).toBe('2026-06-14T12:00:00.000Z');
		expect(written).toHaveLength(1);
		expect(written[0]).toEqual(record);
	});

	it('preserves a caller-supplied id and timestamp', async () => {
		const log = createAuditLog({
			sink: () => undefined,
			clock: fixedClock,
		});
		const record = await log.record(
			baseEntry({ id: 'caller-id', timestamp: '2020-01-01T00:00:00.000Z' }),
		);
		expect(record.id).toBe('caller-id');
		expect(record.timestamp).toBe('2020-01-01T00:00:00.000Z');
	});

	it('applies redaction before validation, dropping raw prompt/output', async () => {
		const written: AiAuditRecord[] = [];
		const log = createAuditLog({
			sink: (r) => void written.push(r),
			clock: fixedClock,
			idFactory: () => 'id',
			redact: (entry) => {
				const { prompt: _p, output: _o, ...rest } = entry;
				return { ...rest, promptHash: 'sha256:p', outputHash: 'sha256:o' };
			},
		});

		const record = await log.record(
			baseEntry({ prompt: 'secret PII', output: 'sensitive answer', promptHash: undefined, outputHash: undefined }),
		);

		expect(record.prompt).toBeUndefined();
		expect(record.output).toBeUndefined();
		expect(record.promptHash).toBe('sha256:p');
		expect(record.outputHash).toBe('sha256:o');
	});

	it('records the human-override flag', async () => {
		const log = createAuditLog({ sink: () => undefined, clock: fixedClock });
		const record = await log.record(baseEntry({ humanOverride: true }));
		expect(record.humanOverride).toBe(true);
	});

	it('awaits an async sink before resolving', async () => {
		const order: string[] = [];
		const log = createAuditLog({
			clock: fixedClock,
			sink: async (r) => {
				await Promise.resolve();
				order.push(`sink:${r.id}`);
			},
			idFactory: () => 'async-id',
		});
		await log.record(baseEntry());
		order.push('after');
		expect(order).toEqual(['sink:async-id', 'after']);
	});

	it('throws AiAuditValidationError and does not call the sink on an invalid entry', async () => {
		const sink = vi.fn();
		const log = createAuditLog({ sink, clock: fixedClock, idFactory: () => 'id' });

		await expect(
			log.record(baseEntry({ model: '' })),
		).rejects.toBeInstanceOf(AiAuditValidationError);
		expect(sink).not.toHaveBeenCalled();
	});

	it('surfaces schema issues on the thrown error', async () => {
		const log = createAuditLog({ sink: () => undefined, clock: fixedClock });
		try {
			await log.record(baseEntry({ purpose: '' }));
			throw new Error('expected throw');
		} catch (err) {
			expect(err).toBeInstanceOf(AiAuditValidationError);
			if (err instanceof AiAuditValidationError) {
				expect(err.issues.length).toBeGreaterThan(0);
			}
		}
	});
});
