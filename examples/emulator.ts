// Known emulator cores + platform resolution (libretro-style).
import { resolveCore, knownCores, normaliseSlug, PLATFORM_CORES } from '@sveltesentio/emulator';

export const core = resolveCore(normaliseSlug('Super Nintendo')); // -> snes core descriptor
export const all = knownCores();
export const snes = PLATFORM_CORES.snes;
