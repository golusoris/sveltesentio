/**
 * Append-with-a-ceiling for the message histories the rune composables keep.
 *
 * `useSSE` and `useConnectStream` both hold a rolling log of what arrived, and
 * both had this trim written out inline and identically. One behaviour, one
 * implementation (HISS-19).
 */

/**
 * `current` with `batch` appended, keeping at most `limit` of the most recent
 * entries.
 *
 * Returns a new array rather than mutating, because the caller holds the list in
 * `$state` and runes observe a reassignment, not an in-place edit.
 *
 * Trimming drops from the front, so the newest entries are the ones kept — a
 * stream that outruns the limit should show what just arrived, not what arrived
 * first. A `limit` of 0 or less keeps nothing, which is the honest reading of
 * "hold no history"; the callers default it to 100.
 */
export function appendBounded<T>(current: readonly T[], batch: readonly T[], limit: number): T[] {
	if (limit <= 0) return [];
	const next = current.concat(batch);
	return next.length > limit ? next.slice(next.length - limit) : next;
}
