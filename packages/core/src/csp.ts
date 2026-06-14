import { newIdV4 } from './id.js';

export type CspSource = string;

export interface CspDirectives {
	'default-src'?: readonly CspSource[];
	'script-src'?: readonly CspSource[];
	'script-src-elem'?: readonly CspSource[];
	'style-src'?: readonly CspSource[];
	'style-src-elem'?: readonly CspSource[];
	'img-src'?: readonly CspSource[];
	'font-src'?: readonly CspSource[];
	'connect-src'?: readonly CspSource[];
	'media-src'?: readonly CspSource[];
	'frame-src'?: readonly CspSource[];
	'worker-src'?: readonly CspSource[];
	'manifest-src'?: readonly CspSource[];
	'object-src'?: readonly CspSource[];
	'base-uri'?: readonly CspSource[];
	'form-action'?: readonly CspSource[];
	'frame-ancestors'?: readonly CspSource[];
	'report-uri'?: readonly string[];
	'report-to'?: string;
	'upgrade-insecure-requests'?: boolean;
}

export function createNonce(): string {
	return newIdV4();
}

export function nonceSource(nonce: string): CspSource {
	return `'nonce-${nonce}'`;
}

export function hashSource(algo: 'sha256' | 'sha384' | 'sha512', base64: string): CspSource {
	return `'${algo}-${base64}'`;
}

export const STRICT_DYNAMIC: CspSource = "'strict-dynamic'";
export const SELF: CspSource = "'self'";
export const NONE: CspSource = "'none'";

export interface StrictCspOptions {
	nonce: string;
	reportUri?: string;
	connectSrc?: readonly CspSource[];
	imgSrc?: readonly CspSource[];
	fontSrc?: readonly CspSource[];
	styleSrc?: readonly CspSource[];
	mediaSrc?: readonly CspSource[];
	extra?: CspDirectives;
}

export function strictCsp(options: StrictCspOptions): CspDirectives {
	const { nonce, reportUri, connectSrc, imgSrc, fontSrc, styleSrc, mediaSrc, extra } = options;
	return {
		'default-src': [SELF],
		'script-src': [STRICT_DYNAMIC, nonceSource(nonce)],
		'style-src': styleSrc ?? [SELF, nonceSource(nonce)],
		'img-src': imgSrc ?? [SELF, 'data:'],
		'font-src': fontSrc ?? [SELF],
		'connect-src': connectSrc ?? [SELF],
		'media-src': mediaSrc ?? [SELF],
		'object-src': [NONE],
		'base-uri': [NONE],
		'frame-ancestors': [NONE],
		'form-action': [SELF],
		'upgrade-insecure-requests': true,
		...(reportUri ? { 'report-uri': [reportUri] } : {}),
		...extra,
	};
}

export function serialiseCsp(directives: CspDirectives): string {
	const parts: string[] = [];
	for (const [name, value] of Object.entries(directives) as Array<[
		keyof CspDirectives,
		CspDirectives[keyof CspDirectives],
	]>) {
		if (value === undefined || value === false) continue;
		if (value === true) {
			parts.push(name);
			continue;
		}
		if (typeof value === 'string') {
			parts.push(`${name} ${value}`);
			continue;
		}
		if (value.length === 0) continue;
		parts.push(`${name} ${value.join(' ')}`);
	}
	return parts.join('; ');
}
