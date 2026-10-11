// The other half of the cycle opened by import-cycle-a.ts; see the note there
// on why both sit under gap/.
import { aName } from './import-cycle-a.js';
export const bName = `b sees ${aName}`;
