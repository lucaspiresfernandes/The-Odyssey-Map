// What a new token is called when its name is taken already: the goblin
// beside the goblin is "Goblin 2". Names are told apart whatever their case.

import { LIMITS } from './types';

/** "Goblin 3" is the stem "Goblin" and the number 3. "Goblin" is its own stem, with no number. */
function parts(name: string): { stem: string; number: number | null } {
	const numbered = /^(.*\S)\s+(\d{1,4})$/.exec(name.trim());
	return numbered
		? { stem: numbered[1], number: Number(numbered[2]) }
		: { stem: name.trim(), number: null };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The highest number a name with this stem has among these. One with no number counts as the first. */
function highest(stem: string, taken: string[]): number {
	let most = 0;
	for (const name of taken) {
		const other = parts(name);
		if (same(other.stem, stem)) most = Math.max(most, other.number ?? 1);
	}
	return most;
}

/** The stem with a number after it, cut short if the two would run past what a name can be. */
function numbered(stem: string, number: number): string {
	const tail = ` ${number}`;
	return stem.slice(0, LIMITS.tokenName - tail.length).trimEnd() + tail;
}

/**
 * What tokens put down together are called, given the names already on the
 * map. A name nobody has is kept as it is. One that is taken, on the map or
 * by another of the same batch, gets the next number: three goblins put down
 * on an empty map are "Goblin 1", "Goblin 2" and "Goblin 3", and one more
 * beside a "Goblin" is "Goblin 2".
 */
export function numberedNames(names: string[], taken: string[]): string[] {
	const used = [...taken];
	return names.map((name) => {
		const { stem } = parts(name);
		const twice = names.filter((other) => same(other, name)).length > 1;
		const held = used.some((other) => same(other, name));
		const called = twice || held ? numbered(stem, highest(stem, used) + 1) : name;
		used.push(called);
		return called;
	});
}

/** What a copy of a token is called: its name with the next number nobody has. */
export function copyName(name: string, taken: string[]): string {
	const { stem } = parts(name);
	return numbered(stem, highest(stem, [...taken, name]) + 1);
}
