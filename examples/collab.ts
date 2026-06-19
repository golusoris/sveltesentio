// Yjs CRDT helpers — observe/snapshot shared arrays.
import { observeYjsArray, snapshotYjsArray, appendToYjsArray } from '@sveltesentio/collab';
import * as Y from 'yjs';

const doc = new Y.Doc();
const items = doc.getArray('items');
const stop = observeYjsArray(items, (next) => console.warn('items', next));
appendToYjsArray(items, { id: 1 });
