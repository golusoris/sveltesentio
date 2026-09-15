// The other half of the cycle opened by import-cycle-a.ts.
import { aName } from './import-cycle-a.js';
export const bName = `b sees ${aName}`;
