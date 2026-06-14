import type * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

export interface ConnectProviderOptions {
	readonly url: string;
	readonly room: string;
	readonly doc: Y.Doc;
	readonly params?: Readonly<Record<string, string>>;
	readonly resyncInterval?: number;
	readonly maxBackoffTime?: number;
	readonly disableBc?: boolean;
	readonly connect?: boolean;
	readonly awareness?: WebsocketProvider['awareness'];
	readonly WebSocketPolyfill?: typeof WebSocket;
	readonly onStatusChange?: (status: ProviderStatus) => void;
	readonly onSync?: (synced: boolean) => void;
}

export interface ConnectedProvider {
	readonly provider: WebsocketProvider;
	readonly disconnect: () => void;
}

export function connectProvider(options: ConnectProviderOptions): ConnectedProvider {
	const {
		url,
		room,
		doc,
		params,
		resyncInterval,
		maxBackoffTime,
		disableBc,
		connect,
		awareness,
		WebSocketPolyfill,
		onStatusChange,
		onSync,
	} = options;

	const providerOptions: ConstructorParameters<typeof WebsocketProvider>[3] = {};
	if (connect !== undefined) providerOptions.connect = connect;
	if (awareness !== undefined) providerOptions.awareness = awareness;
	if (params !== undefined) providerOptions.params = params;
	if (WebSocketPolyfill !== undefined)
		providerOptions.WebSocketPolyfill = WebSocketPolyfill;
	if (resyncInterval !== undefined) providerOptions.resyncInterval = resyncInterval;
	if (maxBackoffTime !== undefined) providerOptions.maxBackoffTime = maxBackoffTime;
	if (disableBc !== undefined) providerOptions.disableBc = disableBc;

	const provider = new WebsocketProvider(url, room, doc, providerOptions);

	const handleStatus = onStatusChange
		? ({ status }: { status: string }) => {
				onStatusChange(normaliseStatus(status));
			}
		: undefined;
	const handleSync = onSync ? (synced: boolean) => onSync(synced) : undefined;

	if (handleStatus) provider.on('status', handleStatus);
	if (handleSync) provider.on('sync', handleSync);

	const disconnect = (): void => {
		if (handleStatus) provider.off('status', handleStatus);
		if (handleSync) provider.off('sync', handleSync);
		provider.disconnect();
		provider.destroy();
	};

	return { provider, disconnect };
}

function normaliseStatus(status: string): ProviderStatus {
	if (status === 'connected') return 'connected';
	if (status === 'connecting') return 'connecting';
	return 'disconnected';
}
