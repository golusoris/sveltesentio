// Known emulator cores + platform resolution (libretro-style).
import { resolveCore, knownCores, normaliseSlug, PLATFORM_CORES } from '@sveltesentio/emulator';

const core = resolveCore(normaliseSlug('Super Nintendo')); // -> snes core descriptor
const all = knownCores();
