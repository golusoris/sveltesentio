// One half of a two-module import cycle; import-cycle-b.ts closes it. No
// import-cycle rule is configured, so neither file is reported.
import { bName } from './import-cycle-b.js';
export const aName = `a sees ${bName}`;
