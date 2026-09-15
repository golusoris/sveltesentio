// Complexity 3, comfortably inside the cap. Legitimate code the rule must not
// report; a finding here would mean the rule over-matches.
export function describe(n: number): string {
	if (n < 0) return 'negative';
	if (n === 0) return 'zero';
	return 'positive';
}
