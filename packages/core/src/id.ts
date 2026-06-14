import { v4 as uuidv4, v7 as uuidv7, validate, version } from 'uuid';

export type Id<Brand extends string = string> = string & { readonly __brand: Brand };

export function newId(): string {
	return uuidv7();
}

export function newIdV4(): string {
	return uuidv4();
}

export function isId(value: unknown): value is string {
	return typeof value === 'string' && validate(value) && version(value) === 7;
}

export function isIdV4(value: unknown): value is string {
	return typeof value === 'string' && validate(value) && version(value) === 4;
}

export function brandId<Brand extends string>(value: string): Id<Brand> {
	if (!isId(value)) throw new TypeError(`Not a valid UUIDv7: ${value}`);
	return value as Id<Brand>;
}

export function idToTimestamp(id: string): number {
	if (!isId(id)) throw new TypeError(`Not a valid UUIDv7: ${id}`);
	const hex = id.replace(/-/g, '').slice(0, 12);
	return Number.parseInt(hex, 16);
}
