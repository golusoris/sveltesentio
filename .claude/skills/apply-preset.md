# Skill: apply-preset

Apply a sveltesentio interface-type preset to a SvelteKit app.

## When to use

When setting up a new app or migrating an existing one to use `@sveltesentio/ui` tokens.

## Steps

### 1. Install the package

```bash
pnpm add @sveltesentio/ui
```

### 2. Choose the preset based on interface type

| App type | Preset | CSS file |
| --- | --- | --- |
| Media server (Jellyfin-style) | `mediaPreset` | `media.css` |
| Dashboard / admin | `dashboardPreset` | `dashboard.css` |
| Standard web app / SaaS | `webappPreset` | `webapp.css` |
| Mobile PWA | `pwaPreset` | `pwa.css` |
| TV / 10-foot UI | `tenFootPreset` | `ten-foot.css` |
| Flow / node editor | `flowPreset` | `flow.css` |

### 3. Import the token CSS in `src/app.css`

```css
@import '@sveltesentio/ui/tokens/media.css'; /* ← chosen preset */
@import 'tailwindcss';
```

### 4. Add ModeWatcher to `src/routes/+layout.svelte` (if using dark mode toggle)

```svelte
<script lang="ts">
  import { ModeWatcher } from 'mode-watcher';
</script>

<ModeWatcher defaultMode="dark" /> <!-- use preset's defaultMode -->
<slot />
```

### 5. Set `color-scheme` on `<html>` in `src/app.html`

```html
<html lang="en" class="%sveltekit.theme%">
```

Or for always-dark presets (media, dashboard, ten-foot, flow):
```html
<html lang="en" style="color-scheme: dark">
```

### 6. (Media / PWA) Add safe-area padding to app shell

```css
/* src/app.css — after preset import */
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
```

## Rules

- Never mix preset CSS files — pick one per app
- All color tokens are oklch — do not add hex/rgb overrides
- Override tokens in `src/app.css` after the preset import, never in the preset file itself
- `mode-watcher` is required for webapp/pwa presets to enable `.dark` class switching
