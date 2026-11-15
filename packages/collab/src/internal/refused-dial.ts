/**
 * The socket stand-in for a refused dial and the reasons a dial is refused,
 * logged and, for a permanent refusal, stopping the provider. Split from
 * `../provider.ts`, its only importer.
 */

import { errorLabel } from './error-label.js';
import { haltDials } from './stop-provider.js';

/** Why a dial was refused; also the reason of its close event. */
export type RefusalReason =
	| 'auth token resolver threw'
	| 'auth binding check threw'
	| 'auth binding replaced while its token resolved'
	| 'auth binding has no transport for its token'
	| 'auth token cannot be encoded for the dial'
	| 'fixed auth token cannot be encoded for the dial'
	| 'dial exceeds the query pair or subprotocol bound'
	| 'socket constructor rejected the dial'
	| 'socket constructor threw'
	| 'provider disconnected by connectProvider'
	| 'auth binding closed by a refused rebind';

/**
 * Refusals the next dial would meet again, so y-websocket's reconnect would
 * retry them forever: a socket constructor rejecting the caller's URL or
 * subprotocols with a `SyntaxError` (`rejectsDial`), a dial over the entry
 * bound, a fixed (string) token that cannot go on the wire, and any dial
 * through a closed binding: after `connectProvider`'s `disconnect`, or after a
 * refused rebind that could not stop the provider. Such a refusal stops the
 * provider (`haltDials`). The others depend on the token, the binding or the
 * moment, a resolver's token and a socket constructor throwing anything else
 * included, and are retried after the backoff. Tests:
 * `test/provider-auth.test.ts` "stops the provider on a dial the socket
 * constructor rejects", "retries a dial the socket constructor throws on with
 * another error", "stops the provider on a fixed token that cannot be encoded"
 * and "closes the earlier binding when a refused rebind cannot stop the
 * provider"; `test/provider-reconnect.test.ts` N21.
 */
const PERMANENT_REFUSALS: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
	'auth binding closed by a refused rebind',
	'dial exceeds the query pair or subprotocol bound',
	'fixed auth token cannot be encoded for the dial',
	'provider disconnected by connectProvider',
	'socket constructor rejected the dial',
]);

/**
 * A listener as `EventTarget` takes it. `null` and, from a caller without types,
 * `undefined` add and remove nothing, as on `EventTarget` (WebIDL nullable
 * `EventListener?`; measured on Node 26.13.1).
 */
type ListenerArgument = Parameters<EventTarget['addEventListener']>[1] | undefined;

/** A refused dial: its reason and, when something threw, the thrown value. */
export interface Refusal {
	readonly reason: RefusalReason;
	readonly cause?: unknown;
}

/** Runs one socket event handler; a throw is logged so the next event still fires. */
function runHandler(handler: () => void): void {
	try {
		handler();
	} catch (error) {
		console.error('[sentio] collab: socket event handler threw:', errorLabel(error));
	}
}

/**
 * Socket stand-in for a refused dial: its token resolver or a check of its
 * binding threw, its binding was replaced while the token resolved, the token
 * cannot be encoded, the dial is over the entry bound, or the socket
 * constructor threw on it. It opens
 * no connection. On the next microtask it fires a plain `error` event, which
 * like a browser's carries no detail, so neither the thrown value nor the token
 * reaches `connection-error` listeners, then `close` with code 1006 and the
 * refusal reason, so y-websocket emits `connection-error` and
 * `connection-close` and backs off before it dials again, as for a refused
 * connection. Each event goes to the `on…` handler, then to the listeners added
 * with `addEventListener`. A throwing `on…` handler or listener is logged and
 * does not stop the close or the later listeners. Each listener is wrapped as
 * it is added (`guard`), because Node's `EventTarget` reports a listener's
 * throw as an uncaught exception after `dispatchEvent` returns, which ends a
 * process without an `uncaughtException` handler.
 *
 * `close()` before the refusal runs turns it into a close without the error.
 * The close still fires, because y-websocket (2.0.4 to 3.1.0) clears
 * `provider.ws` only in `onclose`, and `connect()` dials only while
 * `provider.ws` is null. Tests:
 * `test/provider-reconnect.test.ts` N7, N11; `test/provider-auth.test.ts`
 * "refuses the dial without building a socket when the resolver throws",
 * "fires only the close for a refused dial closed before the refusal runs",
 * "fires the events of a refused dial to its listeners", "logs a throwing
 * listener of a refused dial and still runs the later ones" and "runs a
 * listener added twice once and takes a null or undefined listener as none".
 */
export class RefusedDial extends EventTarget implements WebSocket {
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;
	readonly bufferedAmount = 0;
	readonly extensions = '';
	readonly protocol = '';
	readonly url: string;
	/** Why the dial was refused. */
	readonly reason: RefusalReason;
	/** Whether the refusal stopped the provider (`PERMANENT_REFUSALS`). */
	readonly halted: boolean;
	binaryType: BinaryType = 'blob';
	readyState: WebSocket['readyState'] = this.CONNECTING;
	onclose: WebSocket['onclose'] = null;
	onerror: WebSocket['onerror'] = null;
	onmessage: WebSocket['onmessage'] = null;
	onopen: WebSocket['onopen'] = null;
	/** The wrapper each listener was added as, so `removeEventListener` finds it. */
	private readonly guarded = new WeakMap<EventListenerOrEventListenerObject, EventListener>();

	constructor(url: string, reason: RefusalReason, halted: boolean) {
		super();
		this.url = url;
		this.reason = reason;
		this.halted = halted;
		queueMicrotask(() => {
			this.refuse(reason);
		});
	}

	private refuse(reason: RefusalReason): void {
		const cancelled = this.readyState === this.CLOSING;
		this.readyState = this.CLOSED;
		if (!cancelled) {
			const error = new Event('error');
			runHandler(() => {
				this.onerror?.(error);
			});
			this.dispatchEvent(error);
		}
		const close = Object.assign(new Event('close'), {
			code: 1006,
			reason,
			wasClean: false,
		});
		runHandler(() => {
			this.onclose?.(close);
		});
		this.dispatchEvent(close);
	}

	override addEventListener(
		type: string,
		listener: ListenerArgument,
		options?: AddEventListenerOptions | boolean,
	): void {
		if (listener === null || listener === undefined) return;
		super.addEventListener(type, this.guard(listener), options);
	}

	override removeEventListener(
		type: string,
		listener: ListenerArgument,
		options?: EventListenerOptions | boolean,
	): void {
		if (listener === null || listener === undefined) return;
		const guarded = this.guarded.get(listener);
		if (guarded !== undefined) super.removeEventListener(type, guarded, options);
	}

	/** `listener` run through `runHandler`, one wrapper per listener, called as `EventTarget` would. */
	private guard(listener: EventListenerOrEventListenerObject): EventListener {
		const known = this.guarded.get(listener);
		if (known !== undefined) return known;
		const guarded = (event: Event): void => {
			runHandler(() => {
				if (typeof listener === 'function') listener.call(this, event);
				else listener.handleEvent(event);
			});
		};
		this.guarded.set(listener, guarded);
		return guarded;
	}

	close(): void {
		if (this.readyState === this.CONNECTING) this.readyState = this.CLOSING;
	}

	send(): void {
		// Never opens, and y-websocket sends only after `onopen`.
	}
}

/**
 * Logs a refused dial, with the label of the thrown value when something threw,
 * and returns a socket that dials nothing. A permanent refusal also stops
 * `provider` (`PERMANENT_REFUSALS`), and the log says whether it did.
 */
export function refuseDial(provider: object, url: string, refusal: Refusal): WebSocket {
	const halted = PERMANENT_REFUSALS.has(refusal.reason) && haltDials(provider);
	let outcome = 'dial refused';
	if (halted) outcome = 'dial refused, provider stopped until connect() is called';
	else if (PERMANENT_REFUSALS.has(refusal.reason)) outcome = 'dial refused, provider not stopped';
	const line = `[sentio] collab: ${refusal.reason}; ${outcome}`;
	if ('cause' in refusal) console.error(`${line}:`, errorLabel(refusal.cause));
	else console.error(line);
	return new RefusedDial(url, refusal.reason, halted);
}
