// What the tools of the map are given to work with: the map as it stands,
// what is on it, what is selected, and the way to ask the server for a
// change. The map canvas makes one, and hands it to each tool. Its values
// are read as they are needed, so a tool always sees the map as it is now.

import type { Stage } from '#lib/client/stage.svelte.ts';
import type {
	Command,
	Drawing,
	MapInfo,
	Marker,
	Point,
	Region,
	Token
} from '#lib/shared/types.ts';

export interface Board {
	readonly stage: Stage;
	readonly map: MapInfo;
	/** The size of the map as it is drawn, in its own pixels. */
	readonly W: number;
	readonly H: number;
	/** The side of one grid cell, in map pixels. */
	readonly cell: number;
	readonly battle: boolean;
	readonly tokens: Token[];
	readonly drawings: Drawing[];
	readonly markers: Marker[];
	/** The tokens and drawings selected on a battle map. On a world map, the markers selected together. */
	selectedIds: string[];
	/** Carries commands out. Resolves once the server has done them, or refused. */
	send(commands: Command[], note?: string): Promise<boolean>;
	/**
	 * Where a press is aiming: the middle of the cell under it, or with Alt
	 * held, the exact spot. A world map has no cells to aim at.
	 */
	aim(e: PointerEvent): Point;
}

// What a press on the map has turned into, from the moment the pointer goes
// down until it is let go. The canvas keeps the one that is under way, and
// hands it back to the tool that began it as the pointer moves.

export type Gesture =
	| {
			type: 'pan';
			sx: number;
			sy: number;
			vx: number;
			vy: number;
			moved: boolean;
			/** Held still long enough to ping: letting go is then not a tap. */
			pinged?: boolean;
			/** The middle button of a mouse began it: it only ever moves the map. */
			hand?: boolean;
			target: Element;
	  }
	| { type: 'pinch'; distance: number; k: number; wx: number; wy: number }
	| {
			type: 'vertex';
			region: Region;
			index: number;
			/** The corner is new: it was pulled out of the middle of an edge. */
			added: boolean;
			sx: number;
			sy: number;
			moved: boolean;
	  }
	| {
			type: 'grab';
			/** The one under the pointer. A token snaps to the grid, and the rest follow it. */
			lead: Token | Drawing | Marker;
			/** Where everything that comes along was when it was picked up. */
			origins: Record<string, Point>;
			/** How far it can all go each way before something leaves the map. */
			room: { x0: number; x1: number; y0: number; y1: number };
			sx: number;
			sy: number;
			moved: boolean;
			pinged?: boolean;
			target: Element;
	  }
	| {
			/** A handle of a token is being dragged: the one that turns it, or one that resizes it. */
			type: 'shape';
			how: 'turn' | 'resize';
			token: Token;
			/**
			 * How far off its mark the handle was caught, so the token doesn't
			 * jump to the pointer: in degrees for a turn, map pixels for a size.
			 */
			slack: number;
			/** Which way the pointer was from the token's middle when it caught the handle. */
			bearing: number;
	  }
	/**
	 * The ruler: dragged from one spot to another, or with `route`, being
	 * laid a click at a time, each click another bend in it.
	 */
	| { type: 'measure'; sx: number; sy: number; moved: boolean; route: boolean }
	| { type: 'sketch' }
	/** The area of a spell, dragged out from where the press began. */
	| { type: 'template' }
	/** `add` keeps what was already selected. */
	| { type: 'marquee'; add: boolean }
	/** The brush, swept over the fog of war to clear it there or to put it back. */
	| { type: 'sweep'; how: 'reveal' | 'cover' }
	/** A box over the squares of the map's picture, to line the grid up by. */
	| { type: 'align' }
	/** The pointer held down with the pointing tool: the table is shown where it is. */
	| { type: 'point'; sx: number; sy: number; at: number; moved: boolean };

/** One of them, by its name. */
export type GestureOf<T extends Gesture['type']> = Extract<Gesture, { type: T }>;

/** How far a pointer has to go before a press is a drag and not a click: further for a finger. */
export const dragSlack = (e: PointerEvent) => (e.pointerType === 'mouse' ? 4 : 10);

export const isToken = (thing: Token | Drawing | Marker): thing is Token =>
	!('points' in thing) && !('title' in thing);
export const isMarker = (thing: Token | Drawing | Marker): thing is Marker => 'title' in thing;
