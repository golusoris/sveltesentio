// Node-graph DAG primitives: cycle detection + topological order.
import { buildAdjacency, topologicalSort, findCycles, CycleError } from '@sveltesentio/flow';

const adj = buildAdjacency(edges);
const cycles = findCycles(adj);
if (cycles.length) throw new CycleError(cycles);
const order = topologicalSort(adj); // safe execution order
