// OIDC PKCE + HMAC double-submit CSRF (server-only orchestration, Web Crypto).
import { generateState, generateNonce } from '@sveltesentio/auth';
import { issueCsrfToken, verifyCsrfToken } from '@sveltesentio/auth/csrf';

export const state = generateState();
export const nonce = generateNonce();
// On form render:
export const { token } = await issueCsrfToken(sessionId, secret);
// On submit: false on a forged, expired or foreign token.
export const valid = await verifyCsrfToken(submitted, sessionId, secret);
