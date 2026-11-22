// Turning and resizing a shape by the handles it wears while it is the one
// thing selected. A shape is two points, and a handle moves one of them:
// the rim of a circle, the far end of a cone or of a ray, a corner of a
// box. So a cone is aimed and made longer by the same handle, and a circle
// only ever resized. The other point stays where it is.

import { templateFrom } from '#lib/shared/grid.ts';
import { isTemplate, type Drawing, type Point } from '#lib/shared/types.ts';
import type { Board, GestureOf } from './board.ts';

/**
 * A shape being turned or resized, and the two points it has come to so
 * far. Once let go it waits, no longer `held`, until the server has changed
 * it for everyone. `grip` is where its handle is drawn meanwhile, when that
 * is not one of the two points: on the rim of a circle, under the pointer.
 */
export interface Reshaping {
	id: string;
	points: [Point, Point];
	grip?: Point;
	held: boolean;
}

/** One handle of a shape: where it stands, in map space, and the point that stays put when it is dragged. */
export interface ShapeHandle {
	key: string;
	at: Point;
	anchor: Point;
}

export class Reshaper {
	now = $state.raw<Reshaping | null>(null);

	#board: Board;

	constructor(board: Board) {
		this.#board = board;
	}

	/** The points a drawing is drawn by: as its handle has them, or as it is kept. */
	pointsOf = (drawing: Drawing): Point[] =>
		this.now?.id === drawing.id ? this.now.points : drawing.points;

	/** The handles a shape wears, or none for anything that isn't one. */
	handlesOf(drawing: Drawing): ShapeHandle[] {
		if (!isTemplate(drawing.kind) || drawing.points.length !== 2) return [];
		const [a, b] = this.pointsOf(drawing) as [Point, Point];
		if (drawing.kind !== 'rect') {
			const grip = this.now?.id === drawing.id ? this.now.grip : undefined;
			return [{ key: 'end', at: grip ?? b, anchor: a }];
		}
		// A box has one at each corner, and the corner across from it stays put.
		return [
			{ key: 'a', at: a, anchor: b },
			{ key: 'b', at: b, anchor: a },
			{ key: 'ab', at: [a[0], b[1]], anchor: [b[0], a[1]] },
			{ key: 'ba', at: [b[0], a[1]], anchor: [a[0], b[1]] }
		];
	}

	/** One of the handles on a shape was pressed: it is turned or resized from here until the pointer lets go. */
	press(drawing: Drawing, handle: ShapeHandle, e: PointerEvent): GestureOf<'reshape'> {
		this.now = {
			id: drawing.id,
			points: [handle.anchor, handle.at],
			grip: drawing.kind === 'circle' ? handle.at : undefined,
			held: true
		};
		this.#board.stage.capture(e.pointerId);
		return { type: 'reshape', drawing, anchor: handle.anchor, moved: false };
	}

	drag(g: GestureOf<'reshape'>, e: PointerEvent) {
		const { stage, map, W, H } = this.#board;
		const kind = g.drawing.kind;
		if (!isTemplate(kind)) return;
		g.moved = true;
		const to = stage.toMap(e.clientX, e.clientY);
		// On the grid and a whole number of cells long, unless Alt is held.
		const points = templateFrom(map, kind, g.anchor, to, e.altKey);
		let grip: Point | undefined;
		if (kind === 'circle') {
			// Its handle stays under the pointer's side of it, on the rim.
			const [a, b] = points;
			const r = Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H);
			const dx = (to[0] - a[0]) * W;
			const dy = (to[1] - a[1]) * H;
			const away = Math.hypot(dx, dy) || 1;
			grip = [a[0] + ((dx / away) * r) / W, a[1] + ((dy / away) * r) / H];
		}
		this.now = { id: g.drawing.id, points, grip, held: true };
	}

	lift(g: GestureOf<'reshape'>, completed: boolean) {
		const shaped = this.now;
		const [a, b] = shaped?.points ?? [];
		// A shape with both its points on one spot covers nothing: it stays as it was.
		const flat = a && b && a[0] === b[0] && a[1] === b[1];
		// And a handle pressed and let go where it was has changed nothing.
		if (!shaped || !completed || !g.moved || flat) {
			this.now = null;
			return;
		}
		// Kept as it was let go until the server has changed it, so it never
		// flickers back to what it was.
		const settled = { ...shaped, grip: undefined, held: false };
		this.now = settled;
		this.#board
			.send([{ t: 'drawing.update', id: g.drawing.id, changes: { points: shaped.points } }])
			.then(() => {
				if (this.now === settled) this.now = null;
			});
	}
}
