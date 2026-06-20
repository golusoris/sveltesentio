import { describe, expect, it } from 'vitest';
import {
	SentioConfigError,
	defineSentioConfig,
	interfaceTypeSchema,
	sentioConfigSchema,
} from '../src/sentio-config';

describe('defineSentioConfig', () => {
	it('applies defaults for an empty config', () => {
		expect(defineSentioConfig()).toEqual({
			version: '0.0.0',
			interfaceType: 'desktop',
			features: {},
			theme: 'default',
		});
		expect(defineSentioConfig({})).toEqual(defineSentioConfig());
	});

	it('passes a fully specified config through', () => {
		const config = defineSentioConfig({
			version: '1.2.3',
			interfaceType: 'tenfoot',
			features: { beta: true, legacy: false },
			theme: 'midnight',
		});
		expect(config).toEqual({
			version: '1.2.3',
			interfaceType: 'tenfoot',
			features: { beta: true, legacy: false },
			theme: 'midnight',
		});
	});

	it('rejects an unknown interface-type preset (field path)', () => {
		expect(() => defineSentioConfig({ interfaceType: 'watch' })).toThrow(SentioConfigError);
		try {
			defineSentioConfig({ version: 123 });
		} catch (err) {
			expect(err).toBeInstanceOf(SentioConfigError);
			expect((err as SentioConfigError).message).toContain('version');
		}
	});

	it('rejects an empty version string', () => {
		expect(() => defineSentioConfig({ version: '' })).toThrow(SentioConfigError);
	});

	it('rejects non-object input with a root-path message', () => {
		try {
			defineSentioConfig('nope');
			throw new Error('expected throw');
		} catch (err) {
			expect(err).toBeInstanceOf(SentioConfigError);
			expect((err as SentioConfigError).message).toContain('(root)');
			expect((err as SentioConfigError).name).toBe('SentioConfigError');
		}
	});
});

describe('schemas', () => {
	it('interfaceTypeSchema accepts the three presets only', () => {
		expect(interfaceTypeSchema.parse('handheld')).toBe('handheld');
		expect(interfaceTypeSchema.safeParse('vr').success).toBe(false);
	});

	it('sentioConfigSchema coerces booleans in features strictly', () => {
		expect(sentioConfigSchema.safeParse({ features: { a: 'yes' } }).success).toBe(false);
	});
});
