// Tamper-evident AI audit log with risk tiering (Zod-validated records).
import { createAuditLog, aiAuditRecordSchema, riskTiers } from '@sveltesentio/ai';

const log = createAuditLog({ secret });
await log.record(
  aiAuditRecordSchema.parse({
    prompt,
    model: 'claude-opus-4-8',
    risk: riskTiers.high,
  }),
);
