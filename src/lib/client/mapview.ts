// What the map and the pieces it is built from say to each other: how the
// view lies over the map, and what is in hand on it. Types only.

import type { Drawing, Point, TemplateKind } from '#lib/shared/types.ts';

/**
 * How the map lies on the screen. Things on a map live in map space, 0..1
 * across its picture, and the view turns that into screen pixels:
 * screen = map * size * k + offset.
 */
export interface View {
	x: number;
	y: number;
	k: number;
}

/** A distance being measured on the map, by this person or by someone else at the table. */
export interface Ruler {
	key: string;
	/** The spots it runs through: its two ends, and every bend between them. */
	points: Point[];
	/**
	 * "30 ft" on a battle map. On a world map "84 mi", and how long that is
	 * on the road: "about 3½ days". Empty where the map has no scale, and
	 * for a ruler that has gone nowhere yet.
	 */
	length: string;
	tint: string;
}

/**
 * What this person has in hand: one token or drawing, or a whole selection
 * picked up by one of its own, the `lead`. On a world map it is the markers
 * selected together. `origins` is where each of them was when it was picked
 * up (a drawing by its first point). `by` is how far the pointer has taken
 * them, and `rest` how far they will have gone once let go: the lead token
 * comes down on the grid, and the others keep their places around it. Once
 * let go they wait, no longer `held`, until the server has moved them for
 * everyone.
 */
export interface Carried {
	lead: string;
	origins: Record<string, Point>;
	by: Point;
	rest: Point;
	/** Whether the lead is a token: then the way it has come is measured. */
	measured: boolean;
	held: boolean;
}

/**
 * A token being turned or resized by one of its handles, and what it has
 * come to so far. Once let go it waits, no longer `held`, until the server
 * has changed it for everyone. `at` is where it comes to rest then, if
 * resizing it moved it. `swing` is how far round the token the pointer has
 * taken the handle that turns it, in degrees: not in steps like the token's
 * own turn, so the handle stays with the pointer.
 */
export interface Shaping {
	id: string;
	size?: number;
	rotation?: number;
	swing?: number;
	at?: Point;
	held: boolean;
}

/** A template laid on a battle map, with the two points it is kept as, in the map's pixels. */
export interface LaidTemplate {
	drawing: Drawing;
	kind: TemplateKind;
	a: Point;
	b: Point;
}

/** A text being typed onto the map: a new one, or with an `id`, one being reworded. */
export interface Writing {
	id: string | null;
	at: Point;
	color: string;
}
