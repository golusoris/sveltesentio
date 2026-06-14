import { beforeEach, describe, expect, it, vi } from 'vitest';

const startRegistration = vi.fn();
const startAuthentication = vi.fn();
const browserSupportsWebAuthn = vi.fn(() => true);

vi.mock('@simplewebauthn/browser', () => ({
	startRegistration,
	startAuthentication,
	browserSupportsWebAuthn,
}));

const { registerPasskey, authenticatePasskey, passkeysSupported } = await import('../src/passkey.js');

describe('passkey wrappers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('passes the registration optionsJSON through verbatim', async () => {
		const optionsJSON = {
			challenge: 'chal',
			rp: { name: 'Revenge', id: 'app.example' },
			user: { id: 'uid', name: 'a@b.c', displayName: 'A' },
			pubKeyCredParams: [],
		};
		const response = { id: 'cred-1', type: 'public-key' };
		startRegistration.mockResolvedValueOnce(response);

		const result = await registerPasskey(optionsJSON as never, { useAutoRegister: true });

		expect(startRegistration).toHaveBeenCalledWith({ optionsJSON, useAutoRegister: true });
		expect(result).toBe(response);
	});

	it('passes the authentication optionsJSON through verbatim', async () => {
		const optionsJSON = { challenge: 'chal', rpId: 'app.example' };
		const response = { id: 'cred-2', type: 'public-key' };
		startAuthentication.mockResolvedValueOnce(response);

		const result = await authenticatePasskey(optionsJSON as never);

		expect(startAuthentication).toHaveBeenCalledWith({
			optionsJSON,
			useBrowserAutofill: undefined,
		});
		expect(result).toBe(response);
	});

	it('reports browser support via the underlying library', async () => {
		expect(await passkeysSupported()).toBe(true);
		browserSupportsWebAuthn.mockReturnValueOnce(false);
		expect(await passkeysSupported()).toBe(false);
	});
});
