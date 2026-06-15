export {
	createClient,
	createTransport,
	connectErrorToProblem,
	withCredentialsFetch,
} from './client.js';
export type { CreateClientOptions } from './client.js';

export { useConnectStream } from './use-connect-stream.svelte.js';
export type {
	StreamMethodSelector,
	UseConnectRpcStream,
	UseConnectRpcStreamOptions,
} from './use-connect-stream.svelte.js';
