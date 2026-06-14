/**
 * Command-registry model (ADR-0025). A pure register / search / rank store for
 * a command palette, plus the command shape the `bits-ui` Command `.svelte`
 * consumer renders. No DOM, no bits-ui import — the palette component is a thin
 * consumer of this registry. Folds arca's per-app registry into one DX.
 */

export interface Command {
	/** Stable, unique id. */
	readonly id: string;
	/** Primary display label, also the main search target. */
	readonly title: string;
	/** Optional secondary text shown under the title. */
	readonly subtitle?: string;
	/** Optional group/section label for palette grouping. */
	readonly group?: string;
	/** Extra search terms (aliases) that match this command. */
	readonly keywords?: readonly string[];
	/** Optional `tinykeys`-style shortcut string, e.g. `"$mod+K"`. */
	readonly shortcut?: string;
	/** Invoked when the command is selected. */
	readonly run: () => void | Promise<void>;
}

/** A command paired with its computed relevance score. */
export interface RankedCommand {
	readonly command: Command;
	readonly score: number;
}

/**
 * Immutable command registry. `register` returns a new registry (functional
 * update) so it composes with Svelte 5 `$state` without aliasing surprises.
 */
export class CommandRegistry {
	readonly #commands: ReadonlyMap<string, Command>;

	constructor(commands: ReadonlyMap<string, Command> = new Map()) {
		this.#commands = commands;
	}

	/** All registered commands in insertion order. */
	get commands(): readonly Command[] {
		return [...this.#commands.values()];
	}

	/** Register (or replace by id) one or more commands. Returns a new registry. */
	register(...commands: readonly Command[]): CommandRegistry {
		const next = new Map(this.#commands);
		for (const command of commands) next.set(command.id, command);
		return new CommandRegistry(next);
	}

	/** Remove a command by id. Returns a new registry (no-op if absent). */
	unregister(id: string): CommandRegistry {
		if (!this.#commands.has(id)) return this;
		const next = new Map(this.#commands);
		next.delete(id);
		return new CommandRegistry(next);
	}

	/** Look up a command by id. */
	get(id: string): Command | undefined {
		return this.#commands.get(id);
	}

	/** Search + rank. Empty query returns all commands in insertion order. */
	search(query: string): RankedCommand[] {
		return searchCommands(this.commands, query);
	}
}

/**
 * Score one command against a lowercased query. Higher is better; `0` means no
 * match. Title hits outrank keyword/subtitle hits; prefix outranks substring;
 * a subsequence (fuzzy) match is the weakest positive signal.
 */
export function scoreCommand(command: Command, query: string): number {
	const needle = query.trim().toLowerCase();
	if (needle === '') return 1;

	const title = command.title.toLowerCase();
	if (title === needle) return 100;
	if (title.startsWith(needle)) return 80;
	if (title.includes(needle)) return 60;

	if (command.subtitle && command.subtitle.toLowerCase().includes(needle)) return 40;

	if (command.keywords) {
		for (const keyword of command.keywords) {
			const term = keyword.toLowerCase();
			if (term === needle) return 50;
			if (term.startsWith(needle)) return 45;
			if (term.includes(needle)) return 35;
		}
	}

	if (isSubsequence(needle, title)) return 20;
	return 0;
}

/** Filter + rank `commands` by `query`; stable for equal scores (insertion order). */
export function searchCommands(commands: readonly Command[], query: string): RankedCommand[] {
	const ranked: RankedCommand[] = [];
	for (const command of commands) {
		const score = scoreCommand(command, query);
		if (score > 0) ranked.push({ command, score });
	}
	// Stable: equal scores keep insertion order (index tiebreak).
	return ranked
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
		.map(({ entry }) => entry);
}

/** True if every char of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
	let i = 0;
	for (let j = 0; j < haystack.length && i < needle.length; j++) {
		if (haystack[j] === needle[i]) i++;
	}
	return i === needle.length;
}
