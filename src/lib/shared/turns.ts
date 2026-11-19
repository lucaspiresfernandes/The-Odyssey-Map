// Whose turn it is on a battle map, worked out from the order the tokens
// take them in. The server only keeps the order, whose turn it is and the
// round: see `Turns` in ./types.ts. Moving on from there is arithmetic, and
// it is done here, where the browser and the tests can both get at it.

import type { Turns } from './types';

/**
 * The turn after this one: the next token in the order that is still on the
 * map, and the round it falls in. A token taken off the map keeps its place
 * in the order but is passed over. Coming round to the top of the order
 * again begins a new round. Null when nobody is left to take a turn.
 */
export function nextTurn(turns: Turns, onMap: Iterable<string>): Pick<Turns, 'current' | 'round'> | null {
	const { order, current, round } = turns;
	const here = new Set(onMap);
	const from = current === null ? -1 : order.indexOf(current);
	for (let step = 1; step <= order.length; step++) {
		const at = from + step;
		const id = order[at % order.length];
		if (!here.has(id)) continue;
		// Before the first turn there is no round to finish.
		return { current: id, round: from !== -1 && at >= order.length ? round + 1 : round };
	}
	return null;
}

/**
 * The order with the tokens that show put in this sequence: what the GM
 * sorted them into by hand. The ones that are off the map don't show to be
 * sorted, and keep the places they had, for when they come back.
 */
export function reorderedTurns(order: string[], shown: string[]): string[] {
	const sorted = shown.filter((id) => order.includes(id));
	const moving = new Set(sorted);
	let next = 0;
	return order.map((id) => (moving.has(id) ? sorted[next++] : id));
}

/** The order with these tokens added at the end, the ones already in it left where they are. */
export function joinedTurns(order: string[], ids: string[]): string[] {
	return [...order, ...ids.filter((id) => !order.includes(id))];
}
