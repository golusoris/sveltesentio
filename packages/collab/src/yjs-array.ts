import type * as Y from 'yjs';

export type YjsArrayObserver<T> = (
	event: Y.YArrayEvent<T>,
	transaction: Y.Transaction,
) => void;

export function snapshotYjsArray<T>(yArray: Y.Array<T>): T[] {
	return yArray.toArray();
}

export function observeYjsArray<T>(
	yArray: Y.Array<T>,
	listener: YjsArrayObserver<T>,
): () => void {
	yArray.observe(listener);
	return () => yArray.unobserve(listener);
}

export function appendToYjsArray<T>(yArray: Y.Array<T>, ...values: T[]): void {
	if (values.length === 0) return;
	yArray.push(values);
}

export function insertIntoYjsArray<T>(
	yArray: Y.Array<T>,
	index: number,
	values: readonly T[],
): void {
	if (values.length === 0) return;
	yArray.insert(index, [...values]);
}

export function deleteFromYjsArray<T>(
	yArray: Y.Array<T>,
	index: number,
	length = 1,
): void {
	if (length <= 0) return;
	yArray.delete(index, length);
}

export function transactYjs<R>(
	doc: Y.Doc,
	fn: () => R,
	origin?: unknown,
): R {
	let result!: R;
	doc.transact(() => {
		result = fn();
	}, origin);
	return result;
}
