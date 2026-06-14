import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from '@simplewebauthn/browser';

/** Minimal surface of `@simplewebauthn/browser` these wrappers consume. */
interface BrowserWebAuthn {
	startRegistration(options: {
		optionsJSON: PublicKeyCredentialCreationOptionsJSON;
		useAutoRegister?: boolean | undefined;
	}): Promise<RegistrationResponseJSON>;
	startAuthentication(options: {
		optionsJSON: PublicKeyCredentialRequestOptionsJSON;
		useBrowserAutofill?: boolean | undefined;
	}): Promise<AuthenticationResponseJSON>;
	browserSupportsWebAuthn(): boolean;
}

/**
 * Loads `@simplewebauthn/browser` on demand. It is an OPTIONAL peer dependency, so the import
 * is dynamic: consumers that never call the passkey helpers do not need it installed.
 */
async function loadBrowserWebAuthn(): Promise<BrowserWebAuthn> {
	try {
		const mod = (await import('@simplewebauthn/browser')) as unknown as BrowserWebAuthn;
		return mod;
	} catch (cause) {
		throw new Error(
			'@sveltesentio/auth passkey helpers require the optional peer "@simplewebauthn/browser". Install it to use registerPasskey/authenticatePasskey.',
			{ cause },
		);
	}
}

/**
 * Runs the WebAuthn registration ceremony. The `optionsJSON` blob from the server
 * (`PublicKeyCredentialCreationOptionsJSON`) is passed through verbatim; the returned
 * attestation JSON is posted back to the server's finish endpoint by the caller.
 */
export async function registerPasskey(
	optionsJSON: PublicKeyCredentialCreationOptionsJSON,
	init: { useAutoRegister?: boolean } = {},
): Promise<RegistrationResponseJSON> {
	const webauthn = await loadBrowserWebAuthn();
	return webauthn.startRegistration({ optionsJSON, useAutoRegister: init.useAutoRegister });
}

/**
 * Runs the WebAuthn authentication ceremony. The `optionsJSON` blob from the server
 * (`PublicKeyCredentialRequestOptionsJSON`) is passed through verbatim; the returned
 * assertion JSON is posted back to the server's finish endpoint by the caller.
 */
export async function authenticatePasskey(
	optionsJSON: PublicKeyCredentialRequestOptionsJSON,
	init: { useBrowserAutofill?: boolean } = {},
): Promise<AuthenticationResponseJSON> {
	const webauthn = await loadBrowserWebAuthn();
	return webauthn.startAuthentication({ optionsJSON, useBrowserAutofill: init.useBrowserAutofill });
}

/** Reports whether the current browser advertises WebAuthn support. Returns `false` when the peer is absent. */
export async function passkeysSupported(): Promise<boolean> {
	try {
		const webauthn = await loadBrowserWebAuthn();
		return webauthn.browserSupportsWebAuthn();
	} catch {
		return false;
	}
}
