/**
 * Stopping a provider that must not dial on: `shouldConnect` set to `false`
 * and its socket closed, read back through `Reflect` so a getter, setter or
 * proxy trap that throws counts as not stopped. Split from `../provider.ts`,
 * its only importer.
 */

import { errorLabel } from './error-label.js';

/**
 * Sets `shouldConnect` to `false` and reads it back; a setter or getter that
 * throws counts as not stopped. y-websocket dials only while it is `true`
 * (`setupWS`, y-websocket 2.0.4 to 3.1.0), its scheduled reconnect included,
 * and `connect()` sets it again.
 */
export function haltDials(provider: object): boolean {
	try {
		Reflect.set(provider, 'shouldConnect', false);
		return Reflect.get(provider, 'shouldConnect') === false;
	} catch {
		return false;
	}
}

/**
 * Stops a provider that dialed before its first binding: that socket,
 * `provider.ws`, carried no token. The provider is stopped (`stopProvider`)
 * rather than redialed, so nothing more goes out until the caller calls
 * `connect()`, which dials through the binding. The `console.error` says
 * whether the stop held and names the order that sends no request without the
 * token. Tests: `test/provider-auth.test.ts` "stops a provider that dialed
 * before the first binding"; `test/provider-reconnect.test.ts` N17.
 */
export function stopUnboundDial(provider: object): void {
	if (!holdsSocket(provider)) return;
	const left = stopProvider(provider);
	const outcome =
		left === undefined
			? 'stopped it; call connect() to dial with the token'
			: `could not stop it (${left}), so that socket may stay open without the token`;
	console.error(
		`[sentio] collab: provider dialed before auth was bound, without the token; ${outcome}. Construct it with connect: false and call connect() after bindProviderAuth.`,
	);
}

/** Whether `provider` holds a socket; a `ws` read that throws counts as one, so it gets stopped. */
function holdsSocket(provider: object): boolean {
	try {
		const ws: unknown = Reflect.get(provider, 'ws');
		return typeof ws === 'object' && ws !== null;
	} catch {
		return true;
	}
}

/**
 * Stops `provider` from dialing (`haltDials`) and closes the socket it holds,
 * or returns why it may still be connected: its dials could not be stopped,
 * or reading its socket, its `close()` or calling it threw. A WHATWG `close()` with no
 * arguments never throws (its only throwing steps check a code and a reason);
 * a polyfill's may. y-websocket's `onclose` then clears `provider.ws` and,
 * with `shouldConnect` false, dials no more.
 */
export function stopProvider(provider: object): string | undefined {
	if (!haltDials(provider)) return 'its dials could not be stopped';
	try {
		const ws: unknown = Reflect.get(provider, 'ws');
		if (typeof ws !== 'object' || ws === null) return undefined;
		const close: unknown = Reflect.get(ws, 'close');
		if (typeof close !== 'function') return 'its socket has no close()';
		Reflect.apply(close, ws, []);
	} catch (error) {
		return `reading or closing its socket threw (${errorLabel(error)})`;
	}
	return undefined;
}
