# Skill: add-i18n-key

Add a new translation message key across all locale files in a paraglide-js v2 project.

## When to use

When adding a new user-facing string that needs to be translated.

## Steps

### 1. Locate the messages directory

```
src/lib/paraglide/
  messages/
    en.json      ← source locale
    de.json
    fr.json
    ...
```

### 2. Add the key to ALL locale files

Always add to every locale simultaneously — never leave a key missing.

**en.json** (source):
```json
{
  "existing_key": "Existing message",
  "new_key": "New message in English"
}
```

**de.json**:
```json
{
  "existing_key": "Bestehende Nachricht",
  "new_key": "TODO: Neue Nachricht auf Deutsch"
}
```

Mark untranslated keys with `TODO:` prefix so they're visible in reviews.

### 3. Use the key in a component

```svelte
<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
</script>

<p>{m.new_key()}</p>
```

### 4. Keys with parameters

**en.json**:
```json
{
  "greeting": "Hello, {name}!"
}
```

```svelte
<p>{m.greeting({ name: user.name })}</p>
```

### 5. Run type generation after adding keys

```bash
pnpm --filter <app-name> exec paraglide-js compile --project ./project.inlang
```

## Rules

- Key names: `snake_case`, no dots (use `_` as separator)
- Always add to ALL locale files in the same commit
- Never hardcode UI strings — every user-facing string gets a key
- Use `TODO:` prefix for untranslated keys — they're searchable
- Parameters use `{param_name}` syntax inside the string
