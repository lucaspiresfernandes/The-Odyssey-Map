// What everyone at the table has in hand on a map, as it is shown: the
// rulers and the spots being pointed at, this person's own and the others'.
// And what this browser tells the table of its own hand.
//
// Nobody's mouse is shown to anyone else as it wanders. What the table sees
// of the others is a token being dragged, a ruler, and where someone points
// while they hold the button down.

import type { Ruler } from '#lib/client/mapview.ts';
import { clamped } from '#lib/client/stage.svelte.ts';
import { tintOf } from '#lib/client/tints.ts';
import {
	feetAlong,
	feetCount,
	milesAlong,
	milesCount,
	travelTime
} from '#lib/shared/grid.ts';
import type { Diagonal, Hand, HandSpot, Point, Role, Units } from '#lib/shared/types.ts';
import type { Board } from './board.ts';
import type { Carry } from './carry.svelte.ts';
import type { Pointing } from './pointing.svelte.ts';
import type { RulerTool } from './ruler.svelte.ts';

/** What this browser has in hand on the map in front of it. */
export type Holding = Omit<HandSpot, 'mapId'>;

interface Table {
	/** What the other people looking at this map have in hand. */
	hands(): Hand[];
	me(): { role: Role; userId: string };
	/** How distances are told on this map. */
	scale(): { miles: number | null; dayMiles: number; units: Units; diagonal: Diagonal };
}

export class InHand {
	#board: Board;
	#carry: Carry;
	#ruler: RulerTool;
	#pointer: Pointing;
	#table: Table;

	constructor(board: Board, carry: Carry, ruler: RulerTool, pointer: Pointing, table: Table) {
		this.#board = board;
		this.#carry = carry;
		this.#ruler = ruler;
		this.#pointer = pointer;
		this.#table = table;
	}

	/** How long a way through these spots is, in words: feet on a battle map, miles and days on a world map. */
	#distance(points: Point[]): string {
		const { battle, map, W, H } = this.#board;
		const { miles, dayMiles, units, diagonal } = this.#table.scale();
		const [first] = points;
		if (points.every(([x, y]) => x === first[0] && y === first[1])) return '';
		if (battle) return feetCount(feetAlong(map, points, diagonal), units);
		if (miles === null) return '';
		const far = milesAlong({ width: W, height: H }, miles, points);
		const long = travelTime(far, dayMiles);
		return long ? `${milesCount(far, units)} · ${long}` : milesCount(far, units);
	}

	/** Every distance being measured on this map right now: this person's, then everyone else's. */
	readonly rulers = $derived.by((): Ruler[] => {
		const carry = this.#carry.now;
		const measure = this.#ruler.measure;
		const drawn: Omit<Ruler, 'length'>[] = [];
		// Carrying a token measures how far it has come.
		if (carry?.held && carry.measured) {
			const from = carry.origins[carry.lead];
			const to: Point = [from[0] + carry.rest[0], from[1] + carry.rest[1]];
			drawn.push({ key: 'mine', points: [from, to], tint: '#fff' });
		} else if (measure) drawn.push({ key: 'mine', points: measure, tint: '#fff' });
		for (const other of this.#table.hands()) {
			if (!other.ruler || other.ruler.length < 2) continue;
			drawn.push({ key: other.id, points: other.ruler.map(clamped), tint: tintOf(other) });
		}
		return drawn.map((ruler): Ruler => ({ ...ruler, length: this.#distance(ruler.points) }));
	});

	/** Every spot being pointed at on this map right now: this person's, then everyone else's. */
	readonly pointed = $derived.by(() => {
		const pointing = this.#pointer.at;
		const shown: { key: string; at: Point; tint: string; name: string | null }[] = [];
		// This person's own is drawn where their pointer is, in place of the cursor.
		if (pointing) {
			shown.push({ key: 'mine', at: pointing, tint: tintOf(this.#table.me()), name: null });
		}
		for (const other of this.#table.hands()) {
			if (!other.point) continue;
			shown.push({ key: other.id, at: clamped(other.point), tint: tintOf(other), name: other.name });
		}
		return shown;
	});

	/**
	 * What to tell the table this person has in hand: a token being dragged,
	 * a distance being measured, a spot being pointed at. Null with none of
	 * them: there is nothing to tell, and where the mouse is stays here.
	 */
	mine(): Holding | null {
		const carry = this.#carry.now;
		const measure = this.#ruler.measure;
		const pointing = this.#pointer.at;
		const held = carry && this.#carry.at(carry.lead);
		const holding: Holding = {};
		if (pointing) holding.point = pointing;
		if (carry && held) {
			// The table is shown the token under the pointer in this hand. The
			// rest of a selection arrives when it is put down. A hidden token is
			// moved in secret: nobody is shown it in the GM's hand.
			const { lead, origins, rest } = carry;
			const token = carry.measured ? this.#board.tokens.find((t) => t.id === lead) : null;
			if (token && !token.hidden) {
				holding.drag = { id: lead, x: held[0], y: held[1] };
				const from = origins[lead];
				if (carry.held) holding.ruler = [from, [from[0] + rest[0], from[1] + rest[1]]];
			}
		} else if (measure) {
			holding.ruler = measure;
		}
		return holding.drag || holding.ruler || holding.point ? holding : null;
	}
}
