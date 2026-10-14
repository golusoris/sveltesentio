import { describe, expect, it } from 'vitest';
import { greeting } from '../src/lib/greeting';

describe('greeting', () => {
	it('greets a name', () => {
		expect(greeting('Ada')).toBe('Hello, Ada!');
	});

	it('trims the name', () => {
		expect(greeting('  Ada  ')).toBe('Hello, Ada!');
	});

	it('falls back to world for a blank name', () => {
		expect(greeting('')).toBe('Hello, world!');
		expect(greeting('   ')).toBe('Hello, world!');
	});
});
