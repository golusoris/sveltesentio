// The sanctioned form: markup reaches the sink only through the sanitiser.
// Legitimate code the rule must not report — a finding here would mean
// no-unsanitised-html over-matches.
import { sanitizeHtml } from '@sveltesentio/ui/markdown';

export function render(host: HTMLElement, markup: string): void {
	host.innerHTML = sanitizeHtml(markup);
}

export function clear(host: HTMLElement): void {
	host.innerHTML = '';
}
