# WCAG 2.2 AA — sveltesentio checklist

> Target: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA.
>
> Scope: this document covers the framework surface. Consumers inherit the
> defaults but own content-level verifications (alt text for their media,
> reading-order for their copy, language tags for their translated strings,
> etc.).
>
> Legend: `✅` ships as default; `⚠️` consumer opt-in; `🔲` planned;
> `N/A` not applicable at the framework surface.

## Principle 1 — Perceivable

### 1.1 Text alternatives

| SC | Level | Status | Evidence |
|---|---|---|---|
| 1.1.1 Non-text Content | A | ⚠️ | `eslint-plugin-svelte` a11y rules require `alt` on `<img>`; long-description pattern documented in `@sveltesentio/ui` README. |

### 1.2 Time-based media

| SC | Level | Status | Evidence |
|---|---|---|---|
| 1.2.1 Audio-only / Video-only (Prerecorded) | A | ⚠️ | `@sveltesentio/media` exposes `<Caption>` + `<Transcript>` slots; consumer supplies content. |
| 1.2.2 Captions (Prerecorded) | A | ⚠️ | Vidstack (ADR-0042) supports WebVTT tracks; consumer must author captions. |
| 1.2.3 Audio Description / Media Alternative (Prerecorded) | A | ⚠️ | Same. |
| 1.2.4 Captions (Live) | AA | ⚠️ | Vidstack live captions via HLS text tracks; consumer configures. |
| 1.2.5 Audio Description (Prerecorded) | AA | ⚠️ | Vidstack audio-description track. |

### 1.3 Adaptable

| SC | Level | Status | Evidence |
|---|---|---|---|
| 1.3.1 Info and Relationships | A | ✅ | Svelte compiler enforces semantic HTML via ESLint; `@sveltesentio/ui` primitives map to ARIA roles (bits-ui). |
| 1.3.2 Meaningful Sequence | A | ✅ | DOM order matches visual order in all presets; logical properties only (ADR-0040). |
| 1.3.3 Sensory Characteristics | A | ⚠️ | Convention documented in `docs/ux-principles.md`. |
| 1.3.4 Orientation | AA | ✅ | All presets responsive 320px–2560px; no orientation lock. |
| 1.3.5 Identify Input Purpose | AA | ✅ | `@sveltesentio/forms` maps Zod schemas to autocomplete tokens. |

### 1.4 Distinguishable

| SC | Level | Status | Evidence |
|---|---|---|---|
| 1.4.1 Use of Color | A | ✅ | oklch tokens (ADR-0006) + shape/icon redundancy in `@sveltesentio/ui` states. |
| 1.4.2 Audio Control | A | ✅ | Vidstack autoplay muted + user control. |
| 1.4.3 Contrast (Minimum) | AA | ✅ | Theme tokens (ADR-0046) gated by CI contrast check; axe rule enforced. |
| 1.4.4 Resize Text | AA | ✅ | rem-based spacing (8pt grid); no pixel-fixed sizes in presets. |
| 1.4.5 Images of Text | AA | ✅ | Framework convention — no bitmap text. |
| 1.4.10 Reflow | AA | ✅ | Responsive 320 CSS px single-column at zoom 400 %; verified by Playwright viewport matrix. |
| 1.4.11 Non-text Contrast | AA | ✅ | Focus ring tokens ≥3:1 against adjacent surface; axe rule enforced. |
| 1.4.12 Text Spacing | AA | ✅ | Tailwind 4 preset leaves line-height / letter-spacing / paragraph-spacing overridable. |
| 1.4.13 Content on Hover or Focus | AA | ✅ | bits-ui popovers dismissable via Escape + hoverable + persistent. |

## Principle 2 — Operable

### 2.1 Keyboard accessible

| SC | Level | Status | Evidence |
|---|---|---|---|
| 2.1.1 Keyboard | A | ✅ | Every `@sveltesentio/ui` primitive keyboard-operable; ADR-0027 10-foot focus graph; ADR-0025 command palette. |
| 2.1.2 No Keyboard Trap | A | ✅ | bits-ui focus traps release on Escape. |
| 2.1.4 Character Key Shortcuts | A | ✅ | tinykeys (via ADR-0025) — all shortcuts remappable and pausable. |

### 2.2 Enough time

| SC | Level | Status | Evidence |
|---|---|---|---|
| 2.2.1 Timing Adjustable | A | ✅ | `@sveltesentio/auth` session-timeout warning toast with extend/end actions. |
| 2.2.2 Pause, Stop, Hide | A | ✅ | Toast auto-dismiss pausable on hover/focus (ADR-0016). |

### 2.3 Seizures + physical reactions

| SC | Level | Status | Evidence |
|---|---|---|---|
| 2.3.1 Three Flashes or Below Threshold | A | ✅ | Framework convention; no flashing animations in presets. |

### 2.4 Navigable

| SC | Level | Status | Evidence |
|---|---|---|---|
| 2.4.1 Bypass Blocks | A | ✅ | Skip-link component in `@sveltesentio/shell`; ADR-0027. |
| 2.4.2 Page Titled | A | ✅ | `<svelte:head>` convention enforced by ESLint rule. |
| 2.4.3 Focus Order | A | ✅ | bits-ui + custom 10-foot focus graph (ADR-0027). |
| 2.4.4 Link Purpose (In Context) | A | ⚠️ | Framework convention; consumer authors link text. |
| 2.4.5 Multiple Ways | AA | ⚠️ | Consumer decision. |
| 2.4.6 Headings and Labels | AA | ⚠️ | Same. |
| 2.4.7 Focus Visible | AA | ✅ | Focus ring tokens in every preset (ADR-0046). |
| 2.4.11 Focus Not Obscured (Minimum) | AA | ✅ | Sticky header preset reserves scroll-padding-top. |

### 2.5 Input modalities

| SC | Level | Status | Evidence |
|---|---|---|---|
| 2.5.1 Pointer Gestures | A | ✅ | No path-based gestures without single-pointer equivalent. |
| 2.5.2 Pointer Cancellation | A | ✅ | `click` handlers trigger on up-event (default). |
| 2.5.3 Label in Name | A | ✅ | `eslint-plugin-svelte` rule. |
| 2.5.4 Motion Actuation | A | ✅ | No device-motion-only interactions. |
| 2.5.7 Dragging Movements | AA | ✅ | `@sveltesentio/flow` + `ui/data` drag handles all expose pointer + keyboard alternatives. |
| 2.5.8 Target Size (Minimum) | AA | ✅ | Handheld + 10-foot presets enforce 24×24 CSS px minimum hit target; desktop 32×32. |

## Principle 3 — Understandable

### 3.1 Readable

| SC | Level | Status | Evidence |
|---|---|---|---|
| 3.1.1 Language of Page | A | ✅ | Paraglide v2 sets `<html lang>` (ADR-0017). |
| 3.1.2 Language of Parts | AA | ⚠️ | Paraglide helper available; consumer tags foreign-language spans. |

### 3.2 Predictable

| SC | Level | Status | Evidence |
|---|---|---|---|
| 3.2.1 On Focus | A | ✅ | No context change on focus in any primitive. |
| 3.2.2 On Input | A | ✅ | Same for input events. |
| 3.2.3 Consistent Navigation | AA | ✅ | `@sveltesentio/shell` preset. |
| 3.2.4 Consistent Identification | AA | ✅ | Same. |
| 3.2.6 Consistent Help | A | ✅ | Help link slot in shell preset. |

### 3.3 Input assistance

| SC | Level | Status | Evidence |
|---|---|---|---|
| 3.3.1 Error Identification | A | ✅ | Superforms + `@sveltesentio/forms` field error slots. |
| 3.3.2 Labels or Instructions | A | ✅ | Same. |
| 3.3.3 Error Suggestion | AA | ✅ | Zod custom messages surfaced in field slot. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | ⚠️ | Consumer decision. |
| 3.3.7 Redundant Entry | A | ✅ | `@sveltesentio/forms` autofill + server-side restore. |
| 3.3.8 Accessible Authentication (Minimum) | AA | ✅ | Passkey-first (ADR-0033); no cognitive-function test. |

## Principle 4 — Robust

### 4.1 Compatible

| SC | Level | Status | Evidence |
|---|---|---|---|
| 4.1.2 Name, Role, Value | A | ✅ | bits-ui + ARIA patterns; axe-core enforced. |
| 4.1.3 Status Messages | AA | ✅ | `@sveltesentio/ui/toast` uses `role="status"` / `role="alert"` (ADR-0016). |

## Testing

- **axe-core** — clean on every component via Playwright + Testing Library.
- **Manual keyboard sweep** — every new primitive.
- **Screen-reader smoke** — NVDA 2024.4 + VoiceOver macOS 14 + VoiceOver iOS 17;
  document which combination was used in the PR body.
- **Zoom 400 %** — Playwright viewport matrix 320 × 256 CSS px @ 4× zoom.
- **Reduced motion** — `prefers-reduced-motion: reduce` variant rendered for every animation.

## Known gaps

- 10-foot preset (D-pad TV) exceeds WCAG target-size defaults but needs an
  application-level check for secondary pointer mode (mouse on HTPC).
- `@sveltesentio/flow` canvas pan/zoom controls need documented screen-reader
  alternative text in consumer docs.

## Review cadence

Per point release of WCAG + each sveltesentio minor.
