// The remaining gap: the value was sanitised further up the call chain and
// arrives as a plain identifier, so the rule reports it even though the markup
// is safe — and conversely, a sink reached through a computed member
// (`host[prop] = raw`) is not statically an HTML sink and goes unreported.
//
// Recognising sanitisation at the sink is deliberate: it keeps the guarantee
// visible where markup enters the DOM. This fixture records what that costs.
export function render(host: HTMLElement, alreadySafe: string): void {
	const prop = 'innerHTML';
	host[prop] = alreadySafe;
}
