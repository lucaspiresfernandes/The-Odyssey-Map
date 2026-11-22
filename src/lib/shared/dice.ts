// The dice of the table. A roll is made by the WebSocket server, so that
// nobody's browser has a say in how it lands, and shown to everyone in the
// campaign for a moment. That is all the app does with one: it adds nothing
// up, applies it to nothing, and keeps none of it.

import type { Role } from './types';

/** The dice there are, by how many sides each has. */
export const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
export type Die = (typeof DICE)[number];

export const isDie = (value: unknown): value is Die => (DICE as readonly unknown[]).includes(value);

/** One die someone rolled, and what it came to. */
export interface Roll {
	userId: string;
	name: string;
	role: Role;
	sides: Die;
	/** From 1 to `sides`. */
	result: number;
}

/**
 * Rolls a die: a whole number from 1 to `sides`, each as likely as the
 * next. `random` hands over a whole number from 0 up to but not including
 * 2^32, and is asked again for as long as what it gives would favour the
 * low faces.
 */
export function rollDie(
	sides: number,
	random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]
): number {
	// The largest stretch from 0 that divides evenly among the faces.
	const fair = Math.floor(2 ** 32 / sides) * sides;
	let drawn = random();
	while (drawn >= fair) drawn = random();
	return (drawn % sides) + 1;
}
