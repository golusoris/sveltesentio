/**
 * Icon registry resolution + fallback tests (ADR-0002). Covers loader
 * precedence, fallback to the default (Lucide) loader, miss behaviour, the
 * Lucide adapter's name casing, and the global `registerIconLoader` /
 * `setDefaultIconLoader` API used by downstream `+layout.svelte`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	IconRegistry,
	registerIconLoader,
	setDefaultIconLoader,
	resolveIcon,
	__setRegistry,
	type IconLoader,
} from '../src/icons/registry.js';
import {
	createLucideLoader,
	toPascalCase,
	toKebabCase,
	type LucideIconModule,
} from '../src/icons/lucide.js';

/** Distinct sentinel "components" — the registry treats them as opaque. */
const ArrowLeft = { id: 'ArrowLeft' };
const Home = { id: 'Home' };
const Custom = { id: 'Custom' };

describe('IconRegistry', () => {
	it('resolves via a registered loader', () => {
		const loader: IconLoader = (name) => (name === 'home' ? Home : undefined);
		const reg = new IconRegistry().register(loader);
		expect(reg.resolve('home')).toEqual({ component: Home, source: 'registered' });
	});

	it('returns undefined when nothing matches', () => {
		const reg = new IconRegistry();
		expect(reg.resolve('nope')).toBeUndefined();
	});

	it('most-recently registered loader wins', () => {
		const first: IconLoader = () => Home;
		const second: IconLoader = () => Custom;
		const reg = new IconRegistry().register(first).register(second);
		expect(reg.resolve('x')?.component).toBe(Custom);
	});

	it('falls through to the next loader on undefined/null', () => {
		const miss: IconLoader = () => undefined;
		const nullish: IconLoader = () => null;
		const hit: IconLoader = (name) => (name === 'arrow' ? ArrowLeft : undefined);
		const reg = new IconRegistry().register(hit).register(nullish).register(miss);
		expect(reg.resolve('arrow')?.component).toBe(ArrowLeft);
	});

	it('falls back to the default loader when no registered loader matches', () => {
		const fallback: IconLoader = () => Home;
		const reg = new IconRegistry([], fallback).register(() => undefined);
		expect(reg.resolve('anything')).toEqual({ component: Home, source: 'default' });
	});

	it('prefers a registered loader over the fallback', () => {
		const fallback: IconLoader = () => Home;
		const reg = new IconRegistry([], fallback).register(() => Custom);
		expect(reg.resolve('x')?.component).toBe(Custom);
	});

	it('is immutable: register returns a new registry', () => {
		const empty = new IconRegistry();
		const one = empty.register(() => Home);
		expect(empty.loaders).toHaveLength(0);
		expect(one.loaders).toHaveLength(1);
	});

	it('withFallback returns a new registry with the default set', () => {
		const reg = new IconRegistry();
		const withDefault = reg.withFallback(() => Home);
		expect(reg.resolve('x')).toBeUndefined();
		expect(withDefault.resolve('x')?.source).toBe('default');
	});

	it('a throwing loader does not break resolution; the next loader wins', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const bad: IconLoader = () => {
			throw new Error('boom');
		};
		const good: IconLoader = () => Home;
		// good registered first → it sits after bad in resolution order.
		const reg = new IconRegistry().register(good).register(bad);
		expect(reg.resolve('x')?.component).toBe(Home);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('global registry API', () => {
	beforeEach(() => {
		__setRegistry(new IconRegistry());
	});

	it('registerIconLoader makes resolveIcon find the icon', () => {
		registerIconLoader((name) => (name === 'home' ? Home : undefined));
		expect(resolveIcon('home')?.component).toBe(Home);
	});

	it('returns an unregister function that removes the loader', () => {
		const unregister = registerIconLoader(() => Home);
		expect(resolveIcon('x')?.component).toBe(Home);
		unregister();
		expect(resolveIcon('x')).toBeUndefined();
	});

	it('setDefaultIconLoader installs a fallback honoured after registered loaders', () => {
		setDefaultIconLoader(() => Home);
		expect(resolveIcon('x')).toEqual({ component: Home, source: 'default' });
		registerIconLoader((name) => (name === 'arrow' ? ArrowLeft : undefined));
		expect(resolveIcon('arrow')?.component).toBe(ArrowLeft);
		expect(resolveIcon('other')?.component).toBe(Home);
	});

	it('unregister preserves the default loader', () => {
		setDefaultIconLoader(() => Home);
		const unregister = registerIconLoader((name) => (name === 'arrow' ? ArrowLeft : undefined));
		unregister();
		expect(resolveIcon('arrow')).toEqual({ component: Home, source: 'default' });
	});
});

describe('Lucide adapter', () => {
	const barrel: LucideIconModule = { ArrowLeft, Home };

	it('createLucideLoader resolves kebab names to Pascal barrel keys', () => {
		const loader = createLucideLoader(barrel);
		expect(loader('arrow-left')).toBe(ArrowLeft);
		expect(loader('home')).toBe(Home);
	});

	it('createLucideLoader also accepts Pascal names directly', () => {
		const loader = createLucideLoader(barrel);
		expect(loader('ArrowLeft')).toBe(ArrowLeft);
	});

	it('createLucideLoader returns undefined for unknown names', () => {
		const loader = createLucideLoader(barrel);
		expect(loader('does-not-exist')).toBeUndefined();
	});

	it('wires Lucide as the default and resolves through the global API', () => {
		__setRegistry(new IconRegistry());
		setDefaultIconLoader(createLucideLoader(barrel));
		expect(resolveIcon('arrow-left')?.component).toBe(ArrowLeft);
		expect(resolveIcon('home')?.source).toBe('default');
	});
});

describe('name casing helpers', () => {
	it('toPascalCase', () => {
		expect(toPascalCase('arrow-left')).toBe('ArrowLeft');
		expect(toPascalCase('a-arrow-down')).toBe('AArrowDown');
		expect(toPascalCase('home')).toBe('Home');
		expect(toPascalCase('arrowLeft')).toBe('ArrowLeft');
	});

	it('toKebabCase', () => {
		expect(toKebabCase('ArrowLeft')).toBe('arrow-left');
		expect(toKebabCase('AArrowDown')).toBe('a-arrow-down');
		expect(toKebabCase('home')).toBe('home');
	});
});
