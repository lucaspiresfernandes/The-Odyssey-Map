// Picking things up off a map and putting them down somewhere else: a token
// or a drawing of a battle map, with the rest of what is selected, or the
// markers of a world map that are selected together.

import { within } from '#lib/client/stage.svelte.ts';
import type { Carried } from '#lib/client/mapview.ts';
import { boxOf } from '#lib/shared/drawing.ts';
import { snapToGrid, snapToHalfCell } from '#lib/shared/grid.ts';
import {
	isTemplate,
	type Command,
	type Drawing,
	type Marker,
	type Point,
	type Token
} from '#lib/shared/types.ts';
import { dragSlack, isMarker, isToken, type Board, type GestureOf } from './board.ts';

interface Rights {
	/** Whether a token or a drawing is this person's to move. */
	canGrab(thing: Token | Drawing): boolean;
	canGrabMarker(marker: Marker): boolean;
	/** The markers of a world map that are selected together. */
	selectedMarkers(): Marker[];
}

export class Carry {
	/** What this person has in hand, or null when they hold nothing. */
	now = $state.raw<Carried | null>(null);

	#board: Board;
	#rights: Rights;

	constructor(board: Board, rights: Rights) {
		this.#board = board;
		this.#rights = rights;
	}

	/** How far what is in hand has been taken: with the pointer while held, onto the grid once let go. */
	get by(): Point | null {
		const carry = this.now;
		return carry ? (carry.held ? carry.by : carry.rest) : null;
	}

	/** Where something in this person's hand is right now, or null if it isn't in it. */
	at(id: string): Point | null {
		const from = this.now?.origins[id];
		const by = this.by;
		return from && by ? [from[0] + by[0], from[1] + by[1]] : null;
	}

	/**
	 * Picks up what was pressed. When it is part of the selection, the rest
	 * of the selection that is this person's to move comes along.
	 */
	pickUp(lead: Token | Drawing, e: PointerEvent, target: Element): GestureOf<'grab'> {
		const { tokens, drawings, selectedIds } = this.#board;
		const together = selectedIds.includes(lead.id);
		const along = (thing: Token | Drawing) =>
			thing.id === lead.id ||
			(together && selectedIds.includes(thing.id) && this.#rights.canGrab(thing));
		const origins: Record<string, Point> = {};
		const reached: Point[] = [];
		for (const token of tokens.filter(along)) {
			origins[token.id] = [token.x, token.y];
			reached.push(origins[token.id]);
		}
		for (const drawing of drawings.filter(along)) {
			origins[drawing.id] = drawing.points[0];
			reached.push(...drawing.points);
		}
		const box = boxOf(reached);
		return {
			type: 'grab',
			lead,
			origins,
			room: { x0: -box.x0, x1: 1 - box.x1, y0: -box.y0, y1: 1 - box.y1 },
			sx: e.clientX,
			sy: e.clientY,
			moved: false,
			target
		};
	}

	/** Picks up the markers selected together, by one of them. */
	pickUpMarkers(lead: Marker, e: PointerEvent, target: Element): GestureOf<'grab'> {
		const origins: Record<string, Point> = {};
		for (const marker of this.#rights.selectedMarkers()) {
			if (this.#rights.canGrabMarker(marker)) origins[marker.id] = [marker.x, marker.y];
		}
		const box = boxOf(Object.values(origins));
		return {
			type: 'grab',
			lead,
			origins,
			room: { x0: -box.x0, x1: 1 - box.x1, y0: -box.y0, y1: 1 - box.y1 },
			sx: e.clientX,
			sy: e.clientY,
			moved: false,
			target
		};
	}

	/** What to ask of the server once something carried has been put down. */
	#movesOf(origins: Record<string, Point>, [dx, dy]: Point): Command[] {
		const { markers, tokens } = this.#board;
		const commands: Command[] = [];
		for (const [id, [x, y]] of Object.entries(origins)) {
			if (markers.some((m) => m.id === id)) {
				const changes = { x: within(x + dx, 0, 1), y: within(y + dy, 0, 1) };
				commands.push({ t: 'marker.update', id, changes });
			} else if (tokens.some((t) => t.id === id)) {
				const changes = { x: within(x + dx, 0, 1), y: within(y + dy, 0, 1) };
				commands.push({ t: 'token.update', id, changes });
			} else {
				commands.push({ t: 'drawing.update', id, changes: { move: [dx, dy] } });
			}
		}
		return commands;
	}

	/** The pointer moved with something pressed. True the moment that becomes a drag. */
	drag(g: GestureOf<'grab'>, e: PointerEvent): boolean {
		const board = this.#board;
		const { map, W, H, stage } = board;
		let began = false;
		if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > dragSlack(e)) {
			g.moved = true;
			began = true;
			// Dragging something that isn't selected lets go of what is.
			if (!board.selectedIds.includes(g.lead.id)) board.selectedIds = [];
			stage.capture(e.pointerId);
		}
		if (!g.moved) return began;

		const fit = ([dx, dy]: Point): Point => [
			within(dx, g.room.x0, g.room.x1),
			within(dy, g.room.y0, g.room.y1)
		];
		const { k } = stage.view;
		let by = fit([(e.clientX - g.sx) / (k * W), (e.clientY - g.sy) / (k * H)]);
		let rest = by;
		// A token comes down on the grid, and takes the others the same
		// way. With Alt held it stays exactly where it is put. A marker
		// of a world map has no grid to come down on.
		const lead = isMarker(g.lead) ? null : g.lead;
		if (lead && isToken(lead) && !e.altKey) {
			const { x, y, size } = lead;
			const [rx, ry] = snapToGrid(map, [x + by[0], y + by[1]], size);
			rest = fit([rx - x, ry - y]);
		} else if (lead && !isToken(lead) && isTemplate(lead.kind) && !e.altKey) {
			// A shape keeps to the grid it was drawn on, and all the way
			// there, so the cells it covers can be read while it moves. A
			// box goes from corner to corner of the cells. A circle and a
			// cone start from a corner, the middle of a cell or of a side.
			const [x, y] = lead.points[0];
			const to: Point = [x + by[0], y + by[1]];
			const [rx, ry] = lead.kind === 'rect' ? snapToGrid(map, to, 2) : snapToHalfCell(map, to);
			rest = by = fit([rx - x, ry - y]);
		}
		this.now = {
			lead: g.lead.id,
			origins: g.origins,
			by,
			rest,
			measured: !!lead && isToken(lead),
			held: true
		};
		return began;
	}

	/**
	 * The pointer let go of what it had dragged: it is put down where it comes
	 * to rest, and kept there until the server has moved it. The table sees it
	 * in this hand until then, so it never flickers back to where it was.
	 */
	lift(completed: boolean) {
		const held = this.now;
		if (held && completed && (held.rest[0] !== 0 || held.rest[1] !== 0)) {
			const settled = { ...held, held: false };
			this.now = settled;
			this.#board.send(this.#movesOf(settled.origins, settled.rest)).then(() => {
				if (this.now === settled) this.now = null;
			});
		} else {
			this.now = null;
		}
	}
}
