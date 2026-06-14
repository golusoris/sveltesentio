import type * as Y from 'yjs';

export type YjsTextObserver = (
	event: Y.YTextEvent,
	transaction: Y.Transaction,
) => void;

export function snapshotYjsText(yText: Y.Text): string {
	// eslint-disable-next-line @typescript-eslint/no-base-to-string -- Y.Text#toString returns the document text; yjs's .d.ts inherits Object.toString so the rule can't see the override
	return yText.toString();
}

export function observeYjsText(
	yText: Y.Text,
	listener: YjsTextObserver,
): () => void {
	yText.observe(listener);
	return () => yText.unobserve(listener);
}

export function insertYjsText(
	yText: Y.Text,
	index: number,
	value: string,
): void {
	if (value.length === 0) return;
	yText.insert(index, value);
}

export function deleteYjsText(
	yText: Y.Text,
	index: number,
	length: number,
): void {
	if (length <= 0) return;
	yText.delete(index, length);
}

export function appendYjsText(yText: Y.Text, value: string): void {
	if (value.length === 0) return;
	yText.insert(yText.length, value);
}
