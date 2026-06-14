export type AnnouncerPoliteness = 'polite' | 'assertive';

export interface AnnouncerOptions {
	politeness?: AnnouncerPoliteness;
	regionId?: string;
	document?: Document;
}

const DEFAULT_REGION_ID = 'sentio-a11y-announcer';

export function ensureAnnouncerRegion(options: AnnouncerOptions = {}): HTMLElement | undefined {
	const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
	if (!doc) return undefined;
	const regionId = options.regionId ?? DEFAULT_REGION_ID;
	const politeness = options.politeness ?? 'polite';

	const existing = doc.getElementById(regionId);
	if (existing) return existing;

	const region = doc.createElement('div');
	region.id = regionId;
	region.setAttribute('role', 'status');
	region.setAttribute('aria-live', politeness);
	region.setAttribute('aria-atomic', 'true');
	region.style.position = 'absolute';
	region.style.width = '1px';
	region.style.height = '1px';
	region.style.margin = '-1px';
	region.style.padding = '0';
	region.style.border = '0';
	region.style.clip = 'rect(0 0 0 0)';
	region.style.overflow = 'hidden';
	region.style.whiteSpace = 'nowrap';
	doc.body.appendChild(region);
	return region;
}

export function announceNavigation(message: string, options: AnnouncerOptions = {}): void {
	const region = ensureAnnouncerRegion(options);
	if (!region) return;
	region.textContent = '';
	queueMicrotask(() => {
		region.textContent = message;
	});
}

export function restoreFocus(selector: string, options: { document?: Document } = {}): boolean {
	const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
	if (!doc) return false;
	const target = doc.querySelector<HTMLElement>(selector);
	if (!target) return false;
	target.focus();
	return doc.activeElement === target;
}
