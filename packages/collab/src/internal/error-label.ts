/**
 * Labels for thrown values a log line or a refusal may carry, without the
 * message or fields a thrower chose. Split from `../provider.ts`, its only
 * importer.
 */

/**
 * The error names a log line may carry as they are: the ECMAScript native
 * errors (ECMA-262 §20.5 `Error`, §20.5.5 the native error types, §20.5.7
 * `AggregateError`). Any other `name` is free text a thrower chose.
 */
const NATIVE_ERROR_NAMES: ReadonlySet<string> = new Set([
	'Error',
	'EvalError',
	'RangeError',
	'ReferenceError',
	'SyntaxError',
	'TypeError',
	'URIError',
	'AggregateError',
]);

/**
 * A loggable label for a thrown value: a native error name, `'custom Error'`
 * for any other error, or else the value's type. The message, a custom name and
 * other fields stay out of the log, because a resolver or handler error can
 * carry the token it failed on. Reading the value cannot throw out of here: a
 * `name` getter or a proxy trap that throws gives `'unreadable thrown value'`,
 * so labelling never interrupts a refusal or a close. Tests:
 * `test/provider-auth.test.ts` "logs only the name of a resolver error",
 * "withholds a custom error name" and "labels a thrown value it cannot read".
 */
export function errorLabel(error: unknown): string {
	try {
		if (!(error instanceof Error)) return typeof error;
		const { name } = error;
		return NATIVE_ERROR_NAMES.has(name) ? name : 'custom Error';
	} catch {
		return 'unreadable thrown value';
	}
}

/**
 * Whether a socket constructor threw the error it throws on a dial it can
 * never accept: a `SyntaxError`, which the WHATWG `new WebSocket()` steps
 * throw for a URL that does not parse, has another scheme or a fragment, and
 * for a subprotocol that occurs more than once or is not a
 * `Sec-WebSocket-Protocol` element, as Node's global `WebSocket` and `ws`
 * 8.22.0 (`lib/websocket.js`) do. Browsers and Node throw it as a
 * `DOMException` named `SyntaxError`, `ws` as a native `SyntaxError`; the
 * check reads the type, not the loggable name, so a polyfill error that only
 * calls itself `SyntaxError` is retried. A network failure reaches the
 * socket's `error` and `close` events instead, so any other throw may pass.
 * Reading the value cannot throw out of here. Tests:
 * `test/provider-auth.test.ts` "retries a dial the socket constructor throws
 * on with another error".
 */
export function rejectsDial(cause: unknown): boolean {
	try {
		if (cause instanceof SyntaxError) return true;
		return (
			typeof DOMException === 'function' &&
			cause instanceof DOMException &&
			cause.name === 'SyntaxError'
		);
	} catch {
		return false;
	}
}
