export interface BackoffOptions {
	minMs?: number;
	maxMs?: number;
	jitter?: number;
	base?: number;
	random?: () => number;
}

const DEFAULTS = {
	minMs: 1_000,
	maxMs: 30_000,
	jitter: 0.3,
	base: 2,
};

export function computeBackoff(attempt: number, options: BackoffOptions = {}): number {
	const { minMs, maxMs, jitter, base } = { ...DEFAULTS, ...options };
	if (attempt < 0 || !Number.isFinite(attempt)) return minMs;
	if (jitter < 0 || jitter >= 1) {
		throw new RangeError(`jitter must be in [0, 1); got ${jitter}`);
	}
	const random = options.random ?? Math.random;
	const raw = minMs * Math.pow(base, attempt);
	const capped = Math.min(raw, maxMs);
	const spread = capped * jitter;
	const offset = (random() * 2 - 1) * spread;
	return Math.max(minMs, Math.min(maxMs, Math.round(capped + offset)));
}
