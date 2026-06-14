// Pure, framework-agnostic node-palette model for drag-create flows
// (ADR-0004 / ADR-0010). A palette is the registry of node *types* a user can
// drag onto the canvas; `createNode` mints a concrete `@xyflow/svelte`-shaped
// node object ({id, type, position:{x,y}, data}) at a drop position. No DOM, no
// runes, no `@xyflow/svelte` import — so `./dag` and `./layout` stay importable
// without the optional peer and this stays unit-testable in plain Node.

import { ProblemError } from '@sveltesentio/core/problem';

/** A 2D position on the flow canvas, matching `@xyflow/svelte`'s `XYPosition`. */
export interface XYPosition {
	readonly x: number;
	readonly y: number;
}

/**
 * A node object shaped like `@sveltesentio/flow` consumers' `@xyflow/svelte`
 * `Node`. `data` is structurally `Record<string, unknown>` here so the model
 * stays peer-free; consumers narrow it to their own data type at the edge.
 */
export interface FlowNode<TData extends Record<string, unknown> = Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly position: XYPosition;
	readonly data: TData;
}

/**
 * Mints a stable unique id for a freshly-created node. Injected so tests are
 * deterministic and apps can swap in UUIDv7 (`@sveltesentio/core/id`'s `newId`)
 * or any monotonic source.
 */
export type NodeIdFactory = () => string;

/**
 * A registerable node type. `defaultData` (or `makeData`) seeds the node's
 * `data` on create; per-create `data` overrides are merged over it.
 */
export interface NodeTypeDef<TData extends Record<string, unknown> = Record<string, unknown>> {
	/** The `@xyflow/svelte` node `type` key (must be unique within a palette). */
	readonly type: string;
	/** Human label for palette UIs (drag source). Falls back to {@link type}. */
	readonly label?: string;
	/** Optional category for grouping palette entries (e.g. `"logic"`). */
	readonly category?: string;
	/** Static seed data merged into every node of this type. */
	readonly defaultData?: TData;
	/** Factory seed data — called per create, takes precedence over {@link defaultData}. */
	readonly makeData?: () => TData;
}

/** Options for {@link createNode} — per-create overrides. */
export interface CreateNodeOptions<TData extends Record<string, unknown> = Record<string, unknown>> {
	/** Explicit id (skips the id factory) — useful for deterministic restores. */
	readonly id?: string;
	/** Data merged over the type's seed data. */
	readonly data?: Partial<TData>;
}

/** Options for constructing a {@link NodePalette}. */
export interface NodePaletteOptions {
	/** Id source for created nodes. Defaults to a counter-backed `"node-N"` factory. */
	readonly idFactory?: NodeIdFactory;
}

/** A default, dependency-free id factory: monotonic `"node-1"`, `"node-2"`, … */
export function createCounterIdFactory(prefix = 'node'): NodeIdFactory {
	let counter = 0;
	return () => {
		counter += 1;
		return `${prefix}-${counter}`;
	};
}

/**
 * A node-palette: an ordered registry of node types plus a `createNode`
 * factory. Registration order is preserved by {@link NodePalette.list}.
 */
export class NodePalette {
	readonly #defs = new Map<string, NodeTypeDef>();
	readonly #idFactory: NodeIdFactory;

	constructor(options: NodePaletteOptions = {}) {
		this.#idFactory = options.idFactory ?? createCounterIdFactory();
	}

	/**
	 * Register a node type. Throws an RFC 9457 `ProblemError` on a duplicate
	 * `type` so callers fail loud rather than silently shadow a node kind.
	 */
	registerNodeType<TData extends Record<string, unknown>>(def: NodeTypeDef<TData>): this {
		if (this.#defs.has(def.type)) {
			throw new ProblemError({
				status: 409,
				title: 'Duplicate node type',
				detail: `Node type "${def.type}" is already registered in this palette.`,
				type: 'https://sveltesentio.dev/problems/flow/duplicate-node-type',
			});
		}
		this.#defs.set(def.type, def as NodeTypeDef);
		return this;
	}

	/** Whether a node type is registered. */
	has(type: string): boolean {
		return this.#defs.has(type);
	}

	/** Look up a registered node type definition. */
	get(type: string): NodeTypeDef | undefined {
		return this.#defs.get(type);
	}

	/** The registered node types, in registration order. */
	list(): readonly NodeTypeDef[] {
		return [...this.#defs.values()];
	}

	/**
	 * Mint a concrete node of `type` at `position`. The id comes from the
	 * injected factory unless `options.id` is given. `data` is the type's seed
	 * data ({@link NodeTypeDef.makeData} ?? {@link NodeTypeDef.defaultData})
	 * shallow-merged with per-create `options.data`. Throws an RFC 9457
	 * `ProblemError` for an unknown type.
	 */
	createNode<TData extends Record<string, unknown> = Record<string, unknown>>(
		type: string,
		position: XYPosition,
		options: CreateNodeOptions<TData> = {},
	): FlowNode<TData> {
		const def = this.#defs.get(type);
		if (!def) {
			throw new ProblemError({
				status: 404,
				title: 'Unknown node type',
				detail: `Node type "${type}" is not registered in this palette.`,
				type: 'https://sveltesentio.dev/problems/flow/unknown-node-type',
			});
		}
		const seed = (def.makeData?.() ?? def.defaultData ?? {}) as TData;
		const data = { ...seed, ...(options.data ?? {}) } as TData;
		return {
			id: options.id ?? this.#idFactory(),
			type,
			position: { x: position.x, y: position.y },
			data,
		};
	}
}

/** Convenience constructor mirroring the `create*` factories elsewhere in flow. */
export function createNodePalette(options: NodePaletteOptions = {}): NodePalette {
	return new NodePalette(options);
}
