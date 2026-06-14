import { z } from 'zod';

/**
 * EU AI Act risk tiers (Art. 6 + Annex III). The consumer classifies its own
 * system; the framework only carries the label through the audit record.
 */
export const riskTiers = ['minimal', 'limited', 'high', 'unacceptable'] as const;
export type RiskTier = (typeof riskTiers)[number];

/**
 * Zod v4 schema for a single AI audit record (ADR-0045, EU AI Act Art. 12 logging).
 *
 * Either the raw `prompt`/`output` or their hashes may be supplied — redaction
 * (see {@link createAuditLog}) can drop the raw fields while keeping the hashes.
 */
export const aiAuditRecordSchema = z
	.object({
		/** Correlation id — UUIDv7 recommended (ADR-0023), but any non-empty string is accepted. */
		id: z.string().min(1),
		/** ISO-8601 instant the record was stamped (set by the injected clock). */
		timestamp: z.iso.datetime(),
		/** Model identifier, e.g. `claude-sonnet-4` or `Xenova/all-MiniLM-L6-v2`. */
		model: z.string().min(1),
		/** Raw prompt — omitted when redaction is on; pair with {@link promptHash}. */
		prompt: z.string().optional(),
		/** Hash of the prompt — retained even when the raw prompt is redacted. */
		promptHash: z.string().optional(),
		/** Raw model output — omitted when redaction is on. */
		output: z.string().optional(),
		/** Hash of the output — retained even when the raw output is redacted. */
		outputHash: z.string().optional(),
		/** Pseudonymous user identifier; absent for anonymous flows. */
		userId: z.string().optional(),
		/** The decision or purpose this inference served (Art. 12 traceability). */
		purpose: z.string().min(1),
		/** Whether a human overrode the model's output (Art. 14 human oversight). */
		humanOverride: z.boolean(),
		/** End-to-end latency of the inference in milliseconds. */
		latencyMs: z.number().nonnegative().optional(),
		/** EU AI Act risk classification of the consuming system. */
		riskTier: z.enum(riskTiers).optional(),
		/** Whether the mandated AI-interaction disclosure was shown to the user (Art. 50). */
		disclosureShown: z.boolean().optional(),
		/** Free-form consumer metadata. */
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((r) => r.prompt !== undefined || r.promptHash !== undefined, {
		message: 'either prompt or promptHash is required',
		path: ['prompt'],
	})
	.refine((r) => r.output !== undefined || r.outputHash !== undefined, {
		message: 'either output or outputHash is required',
		path: ['output'],
	});

/** A validated AI audit record. */
export type AiAuditRecord = z.infer<typeof aiAuditRecordSchema>;

/** The caller-supplied entry; `id` and `timestamp` are stamped by the audit log. */
export type AiAuditEntry = Omit<AiAuditRecord, 'id' | 'timestamp'> & {
	id?: string | undefined;
	timestamp?: string | undefined;
};

/** Thrown when an entry fails {@link aiAuditRecordSchema} validation. */
export class AiAuditValidationError extends Error {
	readonly issues: readonly z.core.$ZodIssue[];

	constructor(issues: readonly z.core.$ZodIssue[]) {
		super(`invalid AI audit record: ${issues.map((i) => i.message).join('; ')}`);
		this.name = 'AiAuditValidationError';
		this.issues = issues;
	}
}

/** Destination for completed audit records. May be sync or async. */
export type AuditSink = (record: AiAuditRecord) => void | Promise<void>;

/** Minimal clock seam — matches `@sveltesentio/core` `Clock.now()` (ADR-0052). */
export interface AuditClock {
	now(): Date;
}

/** Redaction policy applied before validation. Returns the entry to persist. */
export type AuditRedactor = (entry: AiAuditEntry) => AiAuditEntry;

export interface CreateAuditLogOptions {
	/** Where validated records are written. */
	sink: AuditSink;
	/** Optional PII redactor run before validation (e.g. drop raw prompt/output). */
	redact?: AuditRedactor | undefined;
	/** Injectable clock for the timestamp; defaults to wall-clock. */
	clock?: AuditClock | undefined;
	/** Injectable id generator for records that omit `id`; defaults to `crypto.randomUUID`. */
	idFactory?: (() => string) | undefined;
}

export interface AuditLog {
	/**
	 * Validate, optionally redact, time-stamp and write a single audit record.
	 *
	 * @throws {AiAuditValidationError} when the record fails the schema.
	 */
	record(entry: AiAuditEntry): Promise<AiAuditRecord>;
}

const defaultClock: AuditClock = { now: () => new Date() };

/**
 * Create an audit-logging seam (ADR-0045). The framework ships no default sink;
 * the consumer supplies one and owns the retention policy.
 */
export function createAuditLog(options: CreateAuditLogOptions): AuditLog {
	const clock = options.clock ?? defaultClock;
	const idFactory = options.idFactory ?? ((): string => crypto.randomUUID());

	return {
		async record(entry: AiAuditEntry): Promise<AiAuditRecord> {
			const redacted = options.redact ? options.redact(entry) : entry;
			const candidate = {
				...redacted,
				id: redacted.id ?? idFactory(),
				timestamp: redacted.timestamp ?? clock.now().toISOString(),
			};
			const parsed = aiAuditRecordSchema.safeParse(candidate);
			if (!parsed.success) {
				throw new AiAuditValidationError(parsed.error.issues);
			}
			await options.sink(parsed.data);
			return parsed.data;
		},
	};
}
