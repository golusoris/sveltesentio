// Five nested conditions: cyclomatic complexity 6, under the cap of 10, but
// cognitive complexity 15 (1+2+3+4+5), over the harness cap of 12, so
// sonarjs/cognitive-complexity refuses it.
export function deepest(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): number {
	if (a) {
		if (b) {
			if (c) {
				if (d) {
					if (e) {
						return 5;
					}
					return 4;
				}
				return 3;
			}
			return 2;
		}
		return 1;
	}
	return 0;
}
