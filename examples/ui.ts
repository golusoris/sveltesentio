// The <Markdown> sink is the security-critical XSS boundary (DOMPurify, tighten-only).
import { renderMarkdown } from '@sveltesentio/ui/markdown';

// Sanitised, control-char-stripped HTML safe for {@html}. Never widen the config.
const safe = renderMarkdown('# Hello\n<script>alert(1)<\/script>'); // -> "<h1>Hello</h1>"
