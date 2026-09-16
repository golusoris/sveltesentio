import { RuleTester } from 'eslint';
import * as svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import {
	chartA11yWrapper,
	noDirectTime,
	noUnsanitisedHtml,
	noRecursion,
	sentioEslint,
} from '../src/eslint';

const ruleTester = new RuleTester({
	languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// `.svelte` fixtures need the svelte parser; everything else mirrors the JS rig.
const svelteRuleTester = new RuleTester({
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		parser: svelteParser,
	},
});

describe('no-direct-time rule', () => {
	it('passes valid + flags invalid time reads', () => {
		ruleTester.run('no-direct-time', noDirectTime, {
			valid: [
				// the sanctioned path: read via the injected clock
				{ code: 'const now = useClock().now();' },
				{ code: 'const t = getClock().monotonic();' },
				// explicit, deterministic construction is allowed
				{ code: 'const d = new Date(serverMs);' },
				{ code: 'const d = new Date(2026, 0, 1);' },
				// unrelated `.now` / `.then` calls must not trip the rule
				{ code: 'foo.now();' },
				{ code: 'Date.parse("2026-01-01");' },
				{ code: 'performance.mark("x");' },
				// computed access is not the banned static form
				{ code: 'Date["now"]();' },
				// `new` of something other than `Date`, and via a non-identifier callee
				{ code: 'const m = new Map();' },
				{ code: 'const x = new foo.Bar();' },
			],
			invalid: [
				{
					code: 'const t = Date.now();',
					errors: [{ messageId: 'dateNow' }],
				},
				{
					code: 'const d = new Date();',
					errors: [{ messageId: 'newDate' }],
				},
				{
					code: 'const m = performance.now();',
					errors: [{ messageId: 'performanceNow' }],
				},
				{
					code: 'const a = Date.now(); const b = new Date();',
					errors: [{ messageId: 'dateNow' }, { messageId: 'newDate' }],
				},
			],
		});
	});

	it('exposes a flat-config plugin shape', () => {
		expect(sentioEslint.meta.name).toBe('@sveltesentio/core');
		expect(sentioEslint.rules['no-direct-time']).toBe(noDirectTime);
		expect(sentioEslint.rules['chart-a11y-wrapper']).toBe(chartA11yWrapper);
		expect(noDirectTime.meta?.messages).toMatchObject({
			dateNow: expect.any(String),
			newDate: expect.any(String),
			performanceNow: expect.any(String),
		});
	});
});

describe('chart-a11y-wrapper rule', () => {
	it('allows chart libs wrapped in <ChartFigure> + flags bare render', () => {
		svelteRuleTester.run('chart-a11y-wrapper', chartA11yWrapper, {
			valid: [
				// the sanctioned wrapper path — layerchart inside <ChartFigure>
				{
					filename: 'LineChart.svelte',
					code: `<script>
  import { LineChart as LcLineChart } from 'layerchart';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="x">
  {#snippet chart()}
    <LcLineChart x={1} />
  {/snippet}
</ChartFigure>`,
				},
				// uPlot wrapped — deeper nesting still counts the ancestor
				{
					filename: 'UPlot.svelte',
					code: `<script>
  import UPlot from 'uplot';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="y">
  {#snippet chart()}
    <div><UPlot /></div>
  {/snippet}
</ChartFigure>`,
				},
				// a layerchart subpath import, still wrapped
				{
					filename: 'Bar.svelte',
					code: `<script>
  import { Bar } from 'layerchart/marks';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="z"><Bar /></ChartFigure>`,
				},
				// no chart-lib import at all — unrelated components never trip
				{
					filename: 'Plain.svelte',
					code: `<script>
  import Button from './Button.svelte';
</script>
<Button>hi</Button>`,
				},
				// an element whose name collides with no chart binding
				{
					filename: 'Collide.svelte',
					code: `<script>
  import { LineChart } from 'layerchart';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="t"><LineChart /></ChartFigure>
<section><p>no chart here</p></section>`,
				},
			],
			invalid: [
				// bare layerchart element, no <ChartFigure> ancestor
				{
					filename: 'Bare.svelte',
					code: `<script>
  import { LineChart as LcLineChart } from 'layerchart';
</script>
<LcLineChart x={1} />`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'LcLineChart', source: 'layerchart' },
						},
					],
				},
				// bare default-imported uPlot element
				{
					filename: 'BareUPlot.svelte',
					code: `<script>
  import UPlot from 'uplot';
</script>
<div><UPlot /></div>`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'UPlot', source: 'uplot' },
						},
					],
				},
				// one wrapped + one bare in the same file → only the bare one trips
				{
					filename: 'Mixed.svelte',
					code: `<script>
  import { LineChart as L } from 'layerchart';
  import ChartFigure from './ChartFigure.svelte';
</script>
<ChartFigure title="x">{#snippet chart()}<L x={1} />{/snippet}</ChartFigure>
<L x={2} />`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'L', source: 'layerchart' },
						},
					],
				},
				// namespace import from a chart lib, used bare
				{
					filename: 'Ns.svelte',
					code: `<script>
  import * as LC from 'layerchart';
</script>
<LC x={1} />`,
					errors: [
						{
							messageId: 'bareChart',
							data: { name: 'LC', source: 'layerchart' },
						},
					],
				},
			],
		});
	});
});

describe('no-unsanitised-html rule', () => {
	it('passes sanitised sinks + flags raw ones', () => {
		ruleTester.run('no-unsanitised-html', noUnsanitisedHtml, {
			valid: [
				// Positive control: the sanctioned form this repo uses.
				{ code: 'host.innerHTML = sanitizeHtml(raw);' },
				{ code: 'host.innerHTML = DOMPurify.sanitize(raw);' },
				{ code: 'host.innerHTML = purifier.sanitize(raw, config);' },
				{ code: 'host.outerHTML = sanitizeHtml(raw);' },
				{ code: 'host.insertAdjacentHTML("beforeend", sanitizeHtml(raw));' },
				// Clearing a node carries no markup.
				{ code: 'host.innerHTML = "";' },
				// Boundary: a similarly-named property that is not an HTML sink.
				{ code: 'host.innerText = raw;' },
				{ code: 'host.textContent = raw;' },
				// A genuinely dynamic member cannot be resolved to a sink, and
				// accusing it would flag every computed property assignment.
				{ code: 'host[key] = raw;' },
				// A computed sink that IS sanitised stays valid.
				{ code: "host['innerHTML'] = sanitizeHtml(raw);" },
				// Boundary: a computed member naming a non-sink property.
				{ code: "host['textContent'] = raw;" },
				// Sanitised a line earlier and passed in by name. The rule used to
				// report this as though it were raw, which is the false accusation
				// that trains people to disable a rule.
				{ code: 'const clean = sanitizeHtml(raw); host.innerHTML = clean;' },
				{ code: 'const clean = purifier.sanitize(raw); host.outerHTML = clean;' },
				{
					code: "const clean = sanitizeHtml(raw); host.insertAdjacentHTML('beforeend', clean);",
				},
				// A `let` could hold something else by the time the sink runs, so it
				// stays unresolved — but it is the assignment that is reported, not
				// the binding, so this is still an accusation about real markup.
				{ code: "const safe = 'x'; host.textContent = safe;" },
			],
			invalid: [
				{
					code: 'host.innerHTML = raw;',
					errors: [{ messageId: 'htmlSink' }],
				},
				{
					code: 'host.innerHTML = `<p>${raw}</p>`;',
					errors: [{ messageId: 'htmlSink' }],
				},
				{
					code: 'host.outerHTML = raw;',
					errors: [{ messageId: 'htmlSink' }],
				},
				// A non-empty literal is still markup.
				{
					code: 'host.innerHTML = "<img onerror=alert(1)>";',
					errors: [{ messageId: 'htmlSink' }],
				},
				{
					code: 'host.insertAdjacentHTML("beforeend", raw);',
					errors: [{ messageId: 'insertAdjacent' }],
				},
				// An unrelated call in the markup slot does not sanitise it.
				{
					code: 'host.innerHTML = escapeNothing(raw);',
					errors: [{ messageId: 'htmlSink' }],
				},
				// Bracket notation names the same sink as dot access. This used to
				// pass: the rule skipped every computed member, so rewriting
				// `host.innerHTML` as `host['innerHTML']` silently disabled an XSS
				// guard with no disable comment to show for it.
				{
					code: "host['innerHTML'] = raw;",
					errors: [{ messageId: 'htmlSink' }],
				},
				{
					code: "host['outerHTML'] = raw;",
					errors: [{ messageId: 'htmlSink' }],
				},
				{
					code: "host['insertAdjacentHTML']('beforeend', raw);",
					errors: [{ messageId: 'insertAdjacent' }],
				},
				// The sink named through a const. This is the gap fixture's shape:
				// bracket notation plus an indirection was a silent bypass.
				{
					code: "const prop = 'innerHTML'; host[prop] = raw;",
					errors: [{ messageId: 'htmlSink' }],
				},
				{
					code: "const prop = 'outerHTML'; host[prop] = raw;",
					errors: [{ messageId: 'htmlSink' }],
				},
				// A const initialised from something that is not a sanitiser does not
				// launder the value.
				{
					code: 'const dirty = escapeNothing(raw); host.innerHTML = dirty;',
					errors: [{ messageId: 'htmlSink' }],
				},
				// Reassignment means the binding is not what it was initialised to,
				// so it does not resolve and the sink is still reported.
				{
					code: 'let maybe = sanitizeHtml(raw); maybe = raw; host.innerHTML = maybe;',
					errors: [{ messageId: 'htmlSink' }],
				},
			],
		});
		expect(sentioEslint.rules['no-unsanitised-html']).toBe(noUnsanitisedHtml);
	});
});

describe('no-recursion rule', () => {
	it('reports a function that calls itself and leaves everything else alone', () => {
		ruleTester.run('no-recursion', noRecursion, {
			valid: [
				// Calls another function, not itself.
				{ code: 'function a() { return b(); } function b() { return 1; }' },
				// Called from outside its own body — that is just use, not recursion.
				{ code: 'function a() { return 1; } a();' },
				// A shadowing inner binding of the same name is a different variable.
				// Name matching would report this; scope analysis does not.
				{ code: 'function a() { const a = () => 1; return a(); }' },
				// Mutual recursion is a cycle between functions, not a self-call. It is
				// out of scope here and documented as such on the rule.
				{ code: 'function a() { return b(); } function b() { return a(); }' },
				// A parameter shares the function's shape but can never be the callee
				// of a self-call.
				{ code: 'function a(cb) { return cb(); }' },
			],
			invalid: [
				{
					code: 'function countdown(n) { return n <= 0 ? 0 : countdown(n - 1); }',
					errors: [{ messageId: 'recursion' }],
				},
				{
					code: 'const walk = (n) => (n <= 0 ? 0 : walk(n - 1));',
					errors: [{ messageId: 'recursion' }],
				},
				// Boundary: two self-calls in one body are two findings.
				{
					code: 'function f(n) { if (n) return f(n - 1); return f(0); }',
					errors: [{ messageId: 'recursion' }, { messageId: 'recursion' }],
				},
			],
		});
	});

	it('is registered on the plugin', () => {
		expect(sentioEslint.rules['no-recursion']).toBe(noRecursion);
	});
});
