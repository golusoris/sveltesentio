import { greeting } from '#lib/greeting.js';

export function load({ data }: { data: { secretLength: number } }): {
	text: string;
	secretLength: number;
} {
	return { text: greeting('load'), secretLength: data.secretLength };
}
