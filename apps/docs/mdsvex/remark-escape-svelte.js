/**
 * remark plugin: escape characters that the Svelte compiler would otherwise
 * mis-parse when mdsvex feeds compiled markdown back through it.
 *
 * The repo's prose contains literal `<` (e.g. "< 500", "<30 Hz", "DataTable<T>",
 * "3D viewer of <subject>") and the occasional `{`/`}`. After markdown→HTML these
 * land in HTML text — Svelte 5 then reads a bare `<` as the start of a component
 * tag and a bare `{` as the start of an expression, breaking the build.
 *
 * Two node kinds need handling:
 *  - `text` nodes: always escaped (they are never intended as markup).
 *  - inline/block `html` nodes: the markdown parser produces these both for
 *    *intentional* HTML the docs author wrote (`<div>`, `<img>`, `<details>` …)
 *    AND for accidental angle brackets that merely *look* like a tag (`<T>`,
 *    `<subject>`, `<canvas>` in prose). We escape only the latter — anything
 *    that is not a recognisable HTML tag, closing tag, self-closing tag, or
 *    comment — so authored HTML survives untouched.
 *
 * Fenced `code` and `inlineCode` are left to mdsvex/Prism, which already escape
 * `<`/`>` inside `<pre>`/`<code>`; touching them would leak entities.
 */

/** @param {string} value */
function escapeForSvelte(value) {
  return value
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&lbrace;')
    .replace(/}/g, '&rbrace;');
}

// Known HTML element names. A `<…>` token whose name is in this set is real
// authored HTML and must survive; anything else (`<T>`, `<subject>`, `<carousel>`,
// `<DialogPrimitive>` — Svelte components or code fragments in prose) is escaped.
const HTML_ELEMENTS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'menu',
  'meta',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'param',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'script',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'svg',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
  // inline SVG/MathML the docs may embed
  'circle',
  'path',
  'rect',
  'line',
  'g',
  'polyline',
  'polygon',
  'text',
  'use',
  'defs',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'stop',
]);

const HTML_TAG = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?\/?>$/;
const HTML_COMMENT = /^<!--[\s\S]*-->$/;

/** @param {string} token */
function isHtmlTag(token) {
  if (HTML_COMMENT.test(token)) return true;
  const match = HTML_TAG.exec(token);
  if (!match || !match[1]) return false;
  return HTML_ELEMENTS.has(match[1].toLowerCase());
}

/** @param {string} value */
function looksLikeIntentionalHtml(value) {
  const trimmed = value.trim();
  if (HTML_COMMENT.test(trimmed)) return true;
  // Every `<…>` token in the run must be a known HTML tag, and there must be no
  // stray `<` left over once the tags are removed.
  const tokens = trimmed.match(/<[^>]*>/g);
  if (!tokens) return false;
  const stripped = trimmed.replace(/<[^>]*>/g, '');
  if (stripped.includes('<') || stripped.includes('>')) return false;
  return tokens.every(isHtmlTag);
}

/**
 * @param {{ type: string; value?: string; children?: unknown[] }} node
 */
function walk(node) {
  if (node.type === 'text' && typeof node.value === 'string') {
    node.value = escapeForSvelte(node.value);
    // mdast `text` renders verbatim; tag as already-safe HTML so the entities
    // survive instead of being re-escaped downstream.
    node.type = 'html';
    return;
  }
  if (node.type === 'html' && typeof node.value === 'string') {
    if (!looksLikeIntentionalHtml(node.value)) {
      node.value = escapeForSvelte(node.value);
    }
    return;
  }
  if (node.type === 'code' || node.type === 'inlineCode') return;
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      walk(/** @type {never} */ (child));
    }
  }
}

export function remarkEscapeSvelte() {
  /** @param {{ type: string; children?: unknown[] }} tree */
  return (tree) => {
    walk(/** @type {never} */ (tree));
  };
}
