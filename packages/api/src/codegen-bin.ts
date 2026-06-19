#!/usr/bin/env node
// Thin bin wrapper around `runCodegen`: supplies the real openapi-typescript
// (optional peer dep, imported lazily so the library half stays dependency-free)
// and Node fs. All logic + branching lives in codegen.ts where it is unit-tested.
import { writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { runCodegen, type CodegenCliDeps } from './codegen.js';

const deps: CodegenCliDeps = {
	openapiTS: (source, options) => openapiTS(source, options),
	astToString: (ast) => astToString(ast as Parameters<typeof astToString>[0]),
	writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
	log: (message) => console.error(message),
};

await runCodegen(deps, process.argv.slice(2));
