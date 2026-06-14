/**
 * `tinykeys`-style keybinding parser + matcher (ADR-0025). Pure: parses a
 * shortcut string (e.g. `"$mod+K"`, `"Shift+?"`) into a normalized binding and
 * matches it against a `KeyboardEvent`-shaped object. The runtime `tinykeys`
 * peer wires DOM listeners; this is the pure parse/compare logic, unit-tested
 * without a browser. `$mod` maps to Meta on Apple platforms, Control elsewhere.
 */

/** The subset of `KeyboardEvent` the matcher reads (DOM-free for testing). */
export interface KeyEventLike {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

/** A parsed shortcut: required modifiers + the non-modifier key (lowercased). */
export interface KeyBinding {
	readonly ctrl: boolean;
	readonly meta: boolean;
	readonly alt: boolean;
	readonly shift: boolean;
	/** `$mod` is unresolved until {@link matchesBinding} sees the platform. */
	readonly mod: boolean;
	/** Lowercased key, e.g. `"k"`, `"enter"`, `"?"`. */
	readonly key: string;
}

const MODIFIER_ALIASES: Record<string, keyof Pick<KeyBinding, 'ctrl' | 'meta' | 'alt' | 'shift' | 'mod'>> = {
	$mod: 'mod',
	mod: 'mod',
	control: 'ctrl',
	ctrl: 'ctrl',
	cmd: 'meta',
	meta: 'meta',
	command: 'meta',
	super: 'meta',
	option: 'alt',
	alt: 'alt',
	shift: 'shift',
};

/**
 * Parse a single shortcut combo like `"$mod+Shift+K"` into a {@link KeyBinding}.
 * Throws if no non-modifier key is present. Order-insensitive.
 */
export function parseBinding(combo: string): KeyBinding {
	const parts = combo
		.split('+')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

	let ctrl = false;
	let meta = false;
	let alt = false;
	let shift = false;
	let mod = false;
	let key: string | null = null;

	for (const part of parts) {
		const modifier = MODIFIER_ALIASES[part.toLowerCase()];
		if (modifier) {
			if (modifier === 'ctrl') ctrl = true;
			else if (modifier === 'meta') meta = true;
			else if (modifier === 'alt') alt = true;
			else if (modifier === 'shift') shift = true;
			else mod = true;
			continue;
		}
		// A non-modifier token is the key; last one wins.
		key = part.toLowerCase();
	}

	if (key === null) {
		throw new Error(`Keybinding "${combo}" has no non-modifier key`);
	}
	return { ctrl, meta, alt, shift, mod, key };
}

/**
 * True if `event` satisfies `binding`. `$mod` resolves to Meta when `apple` is
 * true (default: detect from the platform string), otherwise Control. The
 * non-`$mod` modifiers must match exactly (no extra modifiers held).
 */
export function matchesBinding(
	event: KeyEventLike,
	binding: KeyBinding,
	apple: boolean = isApplePlatform(),
): boolean {
	if (event.key.toLowerCase() !== binding.key) return false;

	let needCtrl = binding.ctrl;
	let needMeta = binding.meta;
	if (binding.mod) {
		if (apple) needMeta = true;
		else needCtrl = true;
	}

	return (
		event.ctrlKey === needCtrl &&
		event.metaKey === needMeta &&
		event.altKey === binding.alt &&
		event.shiftKey === binding.shift
	);
}

/** Parse `"$mod+K"` and test an event in one call. */
export function matchesShortcut(
	event: KeyEventLike,
	combo: string,
	apple?: boolean,
): boolean {
	return matchesBinding(event, parseBinding(combo), apple);
}

/** Detect Apple platforms for `$mod` resolution, SSR-safe. */
export function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') return false;
	const source =
		(navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
		navigator.platform ??
		'';
	return /mac|iphone|ipad|ipod/i.test(source);
}

/**
 * A keymap of shortcut → command id. {@link resolveKeymap} returns the first
 * command id whose binding matches the event, mirroring `tinykeys`' map shape.
 */
export type KeyMap = Readonly<Record<string, string>>;

/** Return the command id bound to the first matching combo, or `null`. */
export function resolveKeymap(event: KeyEventLike, keymap: KeyMap, apple?: boolean): string | null {
	for (const [combo, commandId] of Object.entries(keymap)) {
		if (matchesShortcut(event, combo, apple)) return commandId;
	}
	return null;
}
