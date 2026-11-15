/**
 * The dial URL and subprotocol list a bound provider sends: the auth entries
 * merged into what the caller and y-websocket pass, within the entry bound.
 * Split from `../provider.ts`, its only importer.
 */

/**
 * Entries of `next` absent from `present`, each once. Browsers reject a
 * repeated subprotocol (WHATWG WebSockets, `new WebSocket()` step "occur more
 * than once"). Tests: `test/provider-reconnect.test.ts` N6.
 */
function missingEntries(present: readonly string[], next: readonly string[]): string[] {
	return next.filter((entry, index) => !present.includes(entry) && next.indexOf(entry) === index);
}

/**
 * The caller subprotocols y-websocket passed, as a new array, with the auth
 * entries the caller does not already send appended. The caller's array is
 * never mutated. Tests: `test/provider-reconnect.test.ts` N4, N6.
 */
export function dialProtocols(
	callerProtocols: string | string[] | undefined,
	authProtocols: readonly string[],
): string[] {
	let list: string[] = [];
	if (typeof callerProtocols === 'string') list = [callerProtocols];
	else if (callerProtocols !== undefined) list = [...callerProtocols];
	return [...list, ...missingEntries(list, authProtocols)];
}

/**
 * The key of one `key=value` query pair, decoded as a server's query parser
 * decodes it: `+` as a space and percent-decoding without failing on a broken
 * escape (WHATWG URL, `application/x-www-form-urlencoded` parsing). The
 * leading `&` keeps `URLSearchParams` from dropping a `?` that starts the key,
 * which a server reading the query keeps. Tests:
 * `test/provider-auth.test.ts` "drops a caller pair whose key decodes to the
 * auth key".
 */
function queryKey(pair: string): string {
	const equals = pair.indexOf('=');
	const raw = equals >= 0 ? pair.slice(0, equals) : pair;
	return new URLSearchParams(`&${raw}`).keys().next().value ?? '';
}

/**
 * Most query pairs, and most subprotocols, a bound dial takes. RFC 9110 §4.1
 * asks for URIs of at least 8000 octets; a non-empty pair with its `&` takes
 * two or more, so a URL of that length holds at most 4000 pairs. A subprotocol
 * list gets the same bound. A dial over it is refused before its entries are
 * copied or scanned (`planDial` in `../provider.ts`), and again once the auth
 * entries are added (`authDial`), so the dial that goes out stays within it.
 * Tests:
 * `test/provider-auth.test.ts` "refuses a dial over the entry bound, auth
 * entries counted".
 */
const MAX_DIAL_ENTRIES = 4000;

/**
 * The non-empty pairs of `query`, at most `MAX_DIAL_ENTRIES + 1` of them, so a
 * caller can tell the query went over the bound. An empty pair (`&&`, a
 * trailing `&`) is dropped, as a server's query parser drops it, and does not
 * count. Tests: `test/provider-auth.test.ts` "counts only non-empty query
 * pairs against the entry bound".
 */
function queryPairs(query: string): string[] {
	const pair = /[^&]+/g;
	const pairs: string[] = [];
	for (let match = pair.exec(query); match !== null; match = pair.exec(query)) {
		pairs.push(match[0]);
		if (pairs.length > MAX_DIAL_ENTRIES) break;
	}
	return pairs;
}

/** Whether the non-empty query pairs of `url` or the subprotocols exceed `MAX_DIAL_ENTRIES`. */
export function exceedsEntryBound(url: string, protocols: string | string[] | undefined): boolean {
	if (Array.isArray(protocols) && protocols.length > MAX_DIAL_ENTRIES) return true;
	return queryPairs(splitUrl(url).query).length > MAX_DIAL_ENTRIES;
}

/** A URL cut around its query (RFC 3986 §3). */
interface UrlParts {
	/** Everything before the query. */
	readonly head: string;
	/** The query without its `?`; empty when there is none. */
	readonly query: string;
	/** The fragment with its `#`; empty when there is none. */
	readonly fragment: string;
}

/**
 * Every ASCII tab or newline (WHATWG Infra: U+0009, U+000A, U+000D). The URL
 * parser `new WebSocket()` runs removes them all before reading the URL (WHATWG
 * URL, basic URL parser), so `to<TAB>ken` reaches the server as `token`.
 */
const TAB_OR_NEWLINE = /[\t\n\r]/g;

/**
 * `url` cut as a server's URL parser reads it: tabs and newlines removed first
 * (`TAB_OR_NEWLINE`), then the query runs from the first `?` to the first `#`
 * and may itself hold `?` (RFC 3986 §3.4); a `?` after the first `#` belongs to
 * the fragment (§3.5). Tests: `test/provider-auth.test.ts` "drops a caller key
 * split by a tab or newline, which URL parsing removes".
 */
function splitUrl(url: string): UrlParts {
	const parsed = url.replace(TAB_OR_NEWLINE, '');
	const hash = parsed.indexOf('#');
	const end = hash >= 0 ? hash : parsed.length;
	const mark = parsed.indexOf('?');
	const cut = mark >= 0 && mark < end ? mark : end;
	return {
		head: parsed.slice(0, cut),
		query: cut < end ? parsed.slice(cut + 1, end) : '',
		fragment: parsed.slice(end),
	};
}

/**
 * `url` with the auth query pairs appended to its query, after dropping every
 * caller pair whose key decodes to an auth key (`queryKey`), so a spelling
 * such as `%74oken` cannot send a stale value next to the token. The query is cut as the server reads it (`splitUrl`), so a `?` inside
 * a caller value cannot hide an earlier pair under an auth key. With no auth
 * pairs the URL is returned as is, so a caller pair the token shadowed is sent
 * again once the token is revoked. The caller checks `exceedsEntryBound`
 * first. Tests: `test/provider-reconnect.test.ts` N3, N10, N12;
 * `test/provider-auth.test.ts` "reads the query from the first ? to the
 * fragment, as a server does".
 */
export function dialUrl(url: string, authParams: Readonly<Record<string, string>>): string {
	const authPairs = Object.entries(authParams).map(
		([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
	);
	if (authPairs.length === 0) return url;
	const replaced = new Set(Object.keys(authParams));
	const { head, query, fragment } = splitUrl(url);
	const kept = queryPairs(query).filter((pair) => !replaced.has(queryKey(pair)));
	return `${head}?${[...kept, ...authPairs].join('&')}${fragment}`;
}
