import type { Rule } from 'eslint';

/**
 * Flat-config ESLint plugin bundling sveltesentio's three cross-package
 * invariants:
 *
 * - `no-direct-time` — time must flow through the injected {@link Clock}
 *   (`useClock` / `getClock` from `@sveltesentio/core`) so it is deterministic
 *   and testable (AGENTS.md §Invariants + docs/principles.md §2.1). Banned forms:
 *   `Date.now()`, zero-argument `new Date()`, `performance.now()`.
 * - `chart-a11y-wrapper` — every chart visual rendered from `layerchart` /
 *   `uplot` must go through `@sveltesentio/charts`' `<ChartFigure>` so the WCAG
 *   2.2 SC 1.1.1 text alternative cannot be skipped (charts/AGENTS.md §Invariants,
 *   ADR-0013). A bare `<LineChart>` / `<Chart>` / uPlot element with no
 *   `<ChartFigure>` ancestor is an error.
 * - `no-unsanitised-html` — assigning to an HTML sink (`innerHTML`,
 *   `outerHTML`, `insertAdjacentHTML`) is an error unless the value came from
 *   `sanitizeHtml(...)` or a `.sanitize(...)` call. Svelte's `{@html}` is
 *   covered by `svelte/no-at-html-tags`; nothing checked the TypeScript side
 *   until this rule existed.
 *
 * Register in a flat `eslint.config.js`:
 *
 * ```js
 * import sentio from '@sveltesentio/core/eslint';
 * export default [
 *   {
 *     files: ['src/**\/*.ts'],
 *     plugins: { '@sveltesentio': sentio },
 *     rules: { '@sveltesentio/no-direct-time': 'error' },
 *   },
 *   {
 *     files: ['src/**\/*.svelte'],
 *     plugins: { '@sveltesentio': sentio },
 *     rules: { '@sveltesentio/chart-a11y-wrapper': 'error' },
 *   },
 * ];
 * ```
 */

// Pull the concrete AST node shapes from ESLint's own `Rule.Node` union so we
// don't take a direct dependency on `@types/estree` (ESLint owns that peer).
type Node = Rule.Node;
type CallExpressionNode = Extract<Node, { type: 'CallExpression' }>;
type NewExpressionNode = Extract<Node, { type: 'NewExpression' }>;
type ImportDeclarationNode = Extract<Node, { type: 'ImportDeclaration' }>;
type AssignmentExpressionNode = Extract<Node, { type: 'AssignmentExpression' }>;
type Callee = CallExpressionNode['callee'];

const CLOCK_HINT =
	'route time through the injected Clock — `useClock()`/`getClock()` ' +
	'(or `testClock` in tests) from @sveltesentio/core — so it stays ' +
	'deterministic and testable';

/** Matches `<object>.<property>` where both are plain (non-computed) identifiers. */
function isMemberCall(callee: Callee, objectName: string, propertyName: string): boolean {
	if (callee.type !== 'MemberExpression') return false;
	if (callee.computed) return false;
	if (callee.property.type !== 'Identifier') return false;
	if (callee.property.name !== propertyName) return false;
	return callee.object.type === 'Identifier' && callee.object.name === objectName;
}

const noDirectTime: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description: 'disallow direct wall-clock / monotonic time reads; use the injected Clock',
			recommended: true,
		},
		schema: [],
		messages: {
			dateNow: `Avoid \`Date.now()\` — ${CLOCK_HINT}.`,
			newDate: `Avoid argument-less \`new Date()\` — ${CLOCK_HINT}.`,
			performanceNow: `Avoid \`performance.now()\` — ${CLOCK_HINT}.`,
		},
	},

	create(context: Rule.RuleContext): Rule.RuleListener {
		return {
			CallExpression(node: CallExpressionNode): void {
				if (isMemberCall(node.callee, 'Date', 'now')) {
					context.report({ node, messageId: 'dateNow' });
					return;
				}
				if (isMemberCall(node.callee, 'performance', 'now')) {
					context.report({ node, messageId: 'performanceNow' });
				}
			},

			NewExpression(node: NewExpressionNode): void {
				if (node.callee.type !== 'Identifier') return;
				if (node.callee.name !== 'Date') return;
				// `new Date(serverMs)` is an explicit, deterministic construction —
				// only the zero-argument form reads ambient wall-clock time.
				if (node.arguments.length === 0) {
					context.report({ node, messageId: 'newDate' });
				}
			},
		};
	},
};

// --- chart-a11y-wrapper ------------------------------------------------------

const CHART_LIBS = ['layerchart', 'uplot'] as const;

/** The a11y wrappers from `@sveltesentio/charts` that satisfy the invariant. */
const A11Y_WRAPPER_ELEMENTS = new Set(['ChartFigure']);

const CHART_HINT =
	'render it inside `<ChartFigure>` from @sveltesentio/charts so the chart ' +
	'ships the required visually-hidden data table (WCAG 2.2 SC 1.1.1, ADR-0013)';

/**
 * Structural read of a `svelte-eslint-parser` `SvelteElement` name without
 * depending on the parser's types: a component element exposes
 * `name: { type: 'Identifier' | 'SvelteName', name: string }`. Anything else
 * (HTML tags, member-expression names) is not a chart-library binding and is
 * intentionally ignored.
 */
function svelteElementName(node: unknown): string | undefined {
	if (typeof node !== 'object' || node === null) return undefined;
	const name = (node as { name?: unknown }).name;
	if (typeof name !== 'object' || name === null) return undefined;
	const raw = (name as { name?: unknown }).name;
	return typeof raw === 'string' ? raw : undefined;
}

/** Reads the source string of a (validated) `ImportDeclaration`. */
function importSource(node: ImportDeclarationNode): string {
	const value = node.source.value;
	return typeof value === 'string' ? value : '';
}

/** True for `layerchart`, `layerchart/...`, `uplot`, `uplot/...`. */
function isChartLibSource(source: string): boolean {
	return CHART_LIBS.some((lib) => source === lib || source.startsWith(`${lib}/`));
}

const chartA11yWrapper: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description: 'require chart visuals from layerchart / uplot to be wrapped in <ChartFigure>',
			recommended: true,
		},
		schema: [],
		messages: {
			bareChart: `Bare \`<{{name}}>\` from \`{{source}}\` bypasses the a11y wrapper — ${CHART_HINT}.`,
		},
	},

	create(context: Rule.RuleContext): Rule.RuleListener {
		// Local binding names imported from a chart library → the source they
		// came from, so the message can name it.
		const chartBindings = new Map<string, string>();

		return {
			ImportDeclaration(node: ImportDeclarationNode): void {
				const source = importSource(node);
				if (!isChartLibSource(source)) return;
				for (const spec of node.specifiers) {
					chartBindings.set(spec.local.name, source);
				}
			},

			// `SvelteElement` is the svelte-eslint-parser node for any element;
			// not part of ESLint's core `NodeListener`, so it rides the
			// RuleListener index signature.
			SvelteElement(node: Rule.Node): void {
				const name = svelteElementName(node);
				if (name === undefined) return;
				const source = chartBindings.get(name);
				if (source === undefined) return;
				// Allowed when nested under a sanctioned a11y wrapper element.
				const ancestors = context.sourceCode.getAncestors(node);
				const wrapped = ancestors.some((ancestor) =>
					A11Y_WRAPPER_ELEMENTS.has(svelteElementName(ancestor) ?? ''),
				);
				if (wrapped) return;
				context.report({
					node,
					messageId: 'bareChart',
					data: { name, source },
				});
			},
		};
	},
};

// --- no-unsanitised-html ------------------------------------------------------

const SANITISE_HINT =
	'pass it through the sanitiser first — `sanitizeHtml()` from ' +
	'@sveltesentio/ui/markdown, or DOMPurify.sanitize() directly — so untrusted ' +
	'markup cannot reach the DOM (§2.2 OWASP ASVS L2, ADR-0026)';

/** Property names that parse their assigned string as HTML. */
const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);

/**
 * Whether an expression is a sanitiser call.
 *
 * Recognises `sanitizeHtml(...)`, `DOMPurify.sanitize(...)` and
 * `purifier.sanitize(...)` — the shapes this repository actually uses. A bare
 * identifier holding an already-sanitised string is not recognised, and that is
 * deliberate: the rule reports the sink so the sanitisation is visible where the
 * markup enters the DOM rather than somewhere up the call chain.
 */
function isSanitiserCall(node: { type: string; callee?: unknown } | null | undefined): boolean {
	if (!node || node.type !== 'CallExpression') return false;
	const callee = (node as { callee: Callee }).callee;
	if (callee.type === 'Identifier') return callee.name === 'sanitizeHtml';
	if (callee.type !== 'MemberExpression') return false;
	if (callee.computed || callee.property.type !== 'Identifier') return false;
	return callee.property.name === 'sanitize';
}

/**
 * The part of a member expression this rule reads. Declared structurally rather
 * than as `Extract<Rule.Node, ...>` because the call sites hand over ESTree nodes
 * without the `parent` the Rule.Node union requires.
 */
interface MemberLike {
	computed: boolean;
	property: { type: string; name?: string; value?: unknown };
}

/**
 * Resolves the property name of a member expression when it is statically known.
 *
 * `el.innerHTML` and `el['innerHTML']` name the same sink, so both resolve. The
 * rule used to skip every computed member, which meant bracket notation was a
 * silent bypass of an XSS guard — a refactor to `el[SINK]` disabled the check
 * without a disable comment. A genuinely dynamic `el[name]` stays unresolved,
 * because reporting it would accuse every computed property access.
 */
function staticPropertyName(member: MemberLike): string | undefined {
	if (!member.computed) {
		return member.property.type === 'Identifier' ? member.property.name : undefined;
	}
	const key = member.property;
	return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}

const noUnsanitisedHtml: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'disallow assigning unsanitised markup to an HTML sink (innerHTML, outerHTML, insertAdjacentHTML)',
			recommended: true,
		},
		schema: [],
		messages: {
			htmlSink: `Assigning to \`{{sink}}\` bypasses sanitisation — ${SANITISE_HINT}.`,
			insertAdjacent: `\`insertAdjacentHTML\` parses its argument as HTML — ${SANITISE_HINT}.`,
		},
	},

	create(context: Rule.RuleContext): Rule.RuleListener {
		return {
			AssignmentExpression(node: AssignmentExpressionNode): void {
				const left = node.left;
				if (left.type !== 'MemberExpression') return;
				const sink = staticPropertyName(left);
				if (sink === undefined || !HTML_SINKS.has(sink)) return;
				// An empty string literal clears the node; it cannot carry markup.
				if (node.right.type === 'Literal' && node.right.value === '') return;
				if (isSanitiserCall(node.right)) return;
				context.report({
					node,
					messageId: 'htmlSink',
					data: { sink },
				});
			},

			CallExpression(node: CallExpressionNode): void {
				// Any receiver, unlike the Date/performance checks above: the sink is
				// the method, and it is reached on whatever element is to hand.
				const callee = node.callee;
				if (callee.type !== 'MemberExpression') return;
				if (staticPropertyName(callee) !== 'insertAdjacentHTML') return;
				if (isSanitiserCall(node.arguments[1])) return;
				context.report({ node, messageId: 'insertAdjacent' });
			},
		};
	},
};

/** The flat-config plugin object (`plugins: { '@sveltesentio': sentioEslint }`). */
/**
 * HISS-01 forbids recursion: the call graph must be a Directed Acyclic Graph.
 *
 * Detection uses scope analysis rather than name matching. ESLint hands over the
 * variable a function introduces and every reference to it; a reference inside
 * the function's own range that is the callee of a call is a self-call. Going
 * through the resolved variable means an inner binding shadowing the same name
 * is not mistaken for recursion, and a call through an alias still resolves.
 *
 * Mutual recursion is not reported here — that is a cycle between functions
 * rather than a self-call, and scripts/check-import-cycles.mjs covers the
 * module-level form of it.
 */
/**
 * The variables a self-call could resolve to for this function.
 *
 * A `function f()` declares its own name, so ESLint hands it over directly. An
 * arrow or function expression does not — `const walk = () => walk()` carries
 * its name on the enclosing VariableDeclarator, and reading only the function
 * node misses that whole shape. The first version of this rule did exactly
 * that, and the arrow test caught it.
 *
 * Parameters are dropped: they share the declaration but can never be the
 * callee of a self-call.
 */
function selfNames(sourceCode: Rule.RuleContext['sourceCode'], node: Rule.Node) {
	const own = sourceCode.getDeclaredVariables(node);
	const parent = (node as unknown as { parent?: { type?: string; init?: unknown } }).parent;
	const fromDeclarator =
		parent?.type === 'VariableDeclarator' && parent.init === node
			? sourceCode.getDeclaredVariables(parent as unknown as Rule.Node)
			: [];
	return [...own, ...fromDeclarator].filter(
		(variable) => !variable.defs.some((def) => def.type === 'Parameter'),
	);
}

/**
 * Reports whether `identifier` is a call to `owner` from inside `owner` itself.
 *
 * Extracted from the rule's visitor to stay under the repository's own
 * cyclomatic cap: the combined form measured 11 against a maximum of 10, which
 * `complexity` caught on this very file while the rule was being written.
 */
function isSelfCall(
	identifier: { parent?: unknown; range?: [number, number] | undefined },
	owner: Rule.Node,
): boolean {
	const parent = identifier.parent as { type?: string; callee?: unknown } | undefined;
	if (parent?.type !== 'CallExpression' || parent.callee !== identifier) return false;
	const ownerRange = owner.range;
	const at = identifier.range;
	if (ownerRange === undefined || at === undefined) return false;
	return at[0] >= ownerRange[0] && at[1] <= ownerRange[1];
}

const noRecursion: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description: 'disallow a function from calling itself; the call graph must be a DAG',
			recommended: true,
		},
		schema: [],
		messages: {
			recursion:
				'`{{name}}` calls itself. HISS-01 requires an acyclic call graph — rewrite it as a ' +
				'bounded loop, which also gives the depth an explicit limit (HISS-02).',
		},
	},

	create(context: Rule.RuleContext): Rule.RuleListener {
		const check = (node: Rule.Node): void => {
			for (const variable of selfNames(context.sourceCode, node)) {
				for (const reference of variable.references) {
					if (!isSelfCall(reference.identifier, node)) continue;
					context.report({
						node: reference.identifier,
						messageId: 'recursion',
						data: { name: variable.name },
					});
				}
			}
		};
		return {
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
};

const sentioEslint = {
	meta: { name: '@sveltesentio/core', version: '0.2.0' },
	rules: {
		'no-direct-time': noDirectTime,
		'chart-a11y-wrapper': chartA11yWrapper,
		'no-unsanitised-html': noUnsanitisedHtml,
		'no-recursion': noRecursion,
	},
} satisfies {
	meta: { name: string; version: string };
	rules: Record<string, Rule.RuleModule>;
};

export { noDirectTime, chartA11yWrapper, noUnsanitisedHtml, noRecursion, sentioEslint };
export default sentioEslint;
