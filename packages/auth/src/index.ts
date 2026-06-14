export {
	base64UrlDecode,
	base64UrlEncode,
	generateNonce,
	generateState,
	randomBase64Url,
	randomBytes,
} from './random.js';

export { codeChallengeS256, generatePkceChallenge, generateVerifier } from './pkce.js';
export type { PkceChallenge } from './pkce.js';

export { issueCsrfToken, timingSafeEqual, verifyCsrfToken } from './csrf.js';
export type { CsrfIssueOptions, IssuedCsrfToken } from './csrf.js';

export {
	CSRF_COOKIE_NAME,
	LOGIN_NONCE_COOKIE_NAME,
	SESSION_COOKIE_NAME,
	csrfCookieOptions,
	loginNonceCookieOptions,
	sessionCookieOptions,
} from './cookies.js';
export type {
	CookieOptions,
	CsrfCookieOptionsInit,
	SameSite,
	SessionCookieOptionsInit,
} from './cookies.js';

export { createPermissions } from './permissions.js';
export type { PermissionsApi } from './permissions.js';

export {
	buildAuthorizationUrl,
	createAuthorizationRequest,
	exchangeAuthorizationCode,
} from './oidc.js';
export type {
	AuthorizationRequest,
	AuthorizationRequestInit,
	AuthorizationUrlInit,
	FetchLike,
	TokenExchangeInit,
	TokenResponse,
} from './oidc.js';

export { CSRF_HEADER_NAME, evaluateCsrf, handleCsrf } from './csrf-hook.js';
export type {
	CsrfContext,
	CsrfEvent,
	CsrfRejectionReason,
	CsrfVerifier,
	HandleCsrfOptions,
} from './csrf-hook.js';

export {
	MFA_INVALID,
	MFA_RATE_LIMITED,
	MFA_REQUIRED,
	handleAuthError,
	isMfaRequired,
} from './mfa.js';
export type { AuthErrorState, MfaErrorCodes } from './mfa.js';

export {
	authenticatePasskey,
	passkeysSupported,
	registerPasskey,
} from './passkey.js';
export type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON,
} from './passkey.js';
