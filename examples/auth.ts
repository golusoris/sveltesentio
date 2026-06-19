// OIDC PKCE + HMAC double-submit CSRF (server-only orchestration, Web Crypto).
import { generateState, generateNonce } from '@sveltesentio/auth';
import { issueCsrfToken, verifyCsrfToken } from '@sveltesentio/auth/csrf';

const state = generateState();
const nonce = generateNonce();
// On form render: const token = await issueCsrfToken(secret, sessionId);
// On submit:      await verifyCsrfToken(secret, sessionId, submitted); // throws on mismatch
