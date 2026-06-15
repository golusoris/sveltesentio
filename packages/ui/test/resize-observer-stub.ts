// jsdom has no layout engine: `ResizeObserver` is undefined and `clientHeight`
// is always 0. `VirtualList` derives its rendered window from a
// `bind:clientHeight` viewport, so these shims let a test give the viewport a
// real height and re-fire Svelte's size listener.
//
// Svelte's `bind:clientHeight` registers a border-box `ResizeObserver` whose
// listener calls `set(element.clientHeight)` whenever the observer's callback
// runs (see svelte/internal/client .../bindings/size.js). The stub records every
// observed element so `flushResizeObservers()` can synchronously invoke the
// callbacks, pushing the patched `clientHeight` into the bound `$state`.

type ResizeCallback = (entries: ResizeObserverEntryLike[], observer: unknown) => void;

interface ResizeObserverEntryLike {
	readonly target: Element;
	readonly contentRect: { readonly width: number; readonly height: number };
	readonly borderBoxSize: ReadonlyArray<{ readonly inlineSize: number; readonly blockSize: number }>;
	readonly contentBoxSize: ReadonlyArray<{ readonly inlineSize: number; readonly blockSize: number }>;
}

interface StubbedElement extends HTMLElement {
	__stubClientHeight?: number;
	__stubClientWidth?: number;
}

const active = new Set<ResizeObserverStub>();

class ResizeObserverStub {
	readonly #callback: ResizeCallback;
	readonly #targets = new Set<Element>();

	constructor(callback: ResizeCallback) {
		this.#callback = callback;
		active.add(this);
	}

	observe(target: Element): void {
		this.#targets.add(target);
	}

	unobserve(target: Element): void {
		this.#targets.delete(target);
	}

	disconnect(): void {
		this.#targets.clear();
		active.delete(this);
	}

	/** Re-fire the callback for every observed target (test-driven layout tick). */
	flush(): void {
		const entries: ResizeObserverEntryLike[] = [...this.#targets].map((target) => {
			const el = target as StubbedElement;
			const height = el.__stubClientHeight ?? 0;
			const width = el.__stubClientWidth ?? 0;
			return {
				target,
				contentRect: { width, height },
				borderBoxSize: [{ inlineSize: width, blockSize: height }],
				contentBoxSize: [{ inlineSize: width, blockSize: height }],
			};
		});
		this.#callback(entries, this);
	}
}

/** Install the `ResizeObserver` + configurable `clientHeight`/`clientWidth` shims. */
export function installResizeObserverStub(): void {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

	defineSizeGetter('clientHeight', '__stubClientHeight');
	defineSizeGetter('clientWidth', '__stubClientWidth');
}

function defineSizeGetter(prop: 'clientHeight' | 'clientWidth', field: keyof StubbedElement): void {
	Object.defineProperty(HTMLElement.prototype, prop, {
		configurable: true,
		get(this: StubbedElement) {
			return (this[field] as number | undefined) ?? 0;
		},
	});
}

/** Give `element` a fixed measured size that the `clientHeight`/`Width` getter returns. */
export function setClientSize(element: Element, size: { height?: number; width?: number }): void {
	const el = element as StubbedElement;
	if (size.height !== undefined) el.__stubClientHeight = size.height;
	if (size.width !== undefined) el.__stubClientWidth = size.width;
}

/** Re-fire every active observer's callback so bound size `$state` updates. */
export function flushResizeObservers(): void {
	for (const observer of active) observer.flush();
}
