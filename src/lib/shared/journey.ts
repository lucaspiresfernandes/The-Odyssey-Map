// Where the party has been on one map: the road behind its banner.
//
// Nothing is stored for it. Every move of the party is already an event,
// and the road on a map is those events read in order: see `journeyOn` in
// src/lib/server/queries.ts. The browser keeps it going the same way, one
// move at a time, with the function below.
//
// A journey is a list of stretches. A stretch is the road the party took
// without leaving the map; coming back from elsewhere starts a new one.

import type { Point } from './types';

/** The most stops a journey is kept as. The oldest are forgotten first. */
export const JOURNEY_STOPS = 200;

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/**
 * The journey on a map after one more move of the party. `to` is where on
 * this map it went, or null when it is not on this map afterwards. `was`
 * says whether it stood on this map before.
 *
 * Undoing a move is a move back to the very spot it came from, so a step
 * that returns there takes the last stop off the road instead of adding one.
 */
export function walked(journey: Point[][], to: Point | null, was: boolean): Point[][] {
	if (!to) return journey;
	const road = journey.map((stretch) => [...stretch]);
	const stretch = was ? road.at(-1) : undefined;
	if (!stretch) {
		road.push([to]);
	} else if (stretch.length >= 2 && same(stretch[stretch.length - 2], to)) {
		stretch.pop();
	} else if (!same(stretch[stretch.length - 1], to)) {
		stretch.push(to);
	}

	let stops = road.reduce((sum, each) => sum + each.length, 0);
	while (stops > JOURNEY_STOPS && road.length) {
		// A whole old stretch at a time, then the start of the one that is left.
		if (road.length > 1) stops -= road.shift()!.length;
		else {
			road[0].shift();
			stops--;
		}
	}
	return road;
}
