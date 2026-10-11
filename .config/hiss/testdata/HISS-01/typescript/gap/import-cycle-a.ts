// One half of a two-module import cycle; import-cycle-b.ts closes it.
// scripts/check-import-cycles.mjs (`pnpm check:cycles`) reports the pair.
//
// Filed under gap/ although a gate refuses it: the coverage catalog allows one
// decider per rule and language, the engine scanner is that decider since it
// reads TypeScript, and the scanner stays silent here (cordanaLLM/praetor#1241).
import { bName } from './import-cycle-b.js';
export const aName = `a sees ${bName}`;
