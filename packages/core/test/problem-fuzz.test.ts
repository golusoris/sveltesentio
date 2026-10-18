/**
 * Property-based fuzzing of the RFC 9457 problem parser: arbitrary JSON never
 * throws, and every accepted document round-trips through ProblemError.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ProblemError, parseProblem, problemFromDocument } from '../src/problem.js';

const invalidParam = fc.record({ name: fc.string(), reason: fc.string() });

const problemLike = fc.record(
	{
		type: fc.string(),
		title: fc.string(),
		status: fc.integer({ min: 100, max: 599 }),
		detail: fc.string(),
		instance: fc.string(),
		'invalid-params': fc.array(invalidParam, { maxLength: 4 }),
		code: fc.string(),
		retryAfter: fc.nat(),
	},
	{ requiredKeys: [] },
);

describe('parseProblem — property fuzzing', () => {
	it('never throws on arbitrary JSON values', () => {
		fc.assert(
			fc.property(fc.jsonValue(), (input) => {
				const doc = parseProblem(input);
				if (doc !== undefined) expect(typeof doc.type).toBe('string');
			}),
			{ numRuns: 500 },
		);
	});

	it('round-trips every accepted document through ProblemError', () => {
		fc.assert(
			fc.property(problemLike, (input) => {
				const doc = parseProblem(input);
				expect(doc).toBeDefined();
				if (doc === undefined) return;
				const error = problemFromDocument(doc);
				expect(error).toBeInstanceOf(ProblemError);
				expect(parseProblem(JSON.parse(JSON.stringify(error)))).toEqual(doc);
			}),
			{ numRuns: 300 },
		);
	});

	it('refuses a non-integer status', () => {
		fc.assert(
			fc.property(
				fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
				(status) => {
					expect(parseProblem({ type: 'about:blank', status })).toBeUndefined();
				},
			),
		);
	});
});
