export {
	type YjsArrayObserver,
	snapshotYjsArray,
	observeYjsArray,
	appendToYjsArray,
	insertIntoYjsArray,
	deleteFromYjsArray,
	transactYjs,
} from './yjs-array.js';

export {
	type YjsMapObserver,
	snapshotYjsMap,
	snapshotYjsMapEntries,
	observeYjsMap,
	setYjsMap,
	deleteYjsMap,
	clearYjsMap,
} from './yjs-map.js';

export {
	type YjsTextObserver,
	snapshotYjsText,
	observeYjsText,
	insertYjsText,
	deleteYjsText,
	appendYjsText,
} from './yjs-text.js';

export {
	type ProviderStatus,
	type ConnectProviderOptions,
	type ConnectedProvider,
	connectProvider,
} from './provider.js';

export { type YjsArrayStore, createYjsStore } from './createYjsStore.svelte.js';
export { type YjsMapStore, createYjsMap } from './createYjsMap.svelte.js';
export { type YjsTextStore, createYjsText } from './createYjsText.svelte.js';

export {
	type PresenceState,
	type AwarenessChange,
	type AwarenessEvent,
	type AwarenessLike,
	type PresenceEntry,
	type PresenceDiff,
	type ObservePresenceOptions,
	setLocalPresence,
	patchLocalPresence,
	snapshotPresence,
	snapshotOthers,
	observePresence,
	diffPresence,
} from './awareness.js';

export {
	type PresenceStore,
	type PresenceStoreOptions,
	createPresenceStore,
} from './presence-store.svelte.js';
