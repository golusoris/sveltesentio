// A public export of the shape the coverage gate measures. Every package
// declares vitest thresholds, so an export left entirely untested pulls the
// package below its floor and fails `turbo test`.
//
// It is a positive fixture for the threshold, not for the three dimensions:
// nothing checks that a negative and a boundary case exist, which is why the
// claim is partial rather than enforced.
export function clampRatio(value: number): number {
	if (Number.isNaN(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}
