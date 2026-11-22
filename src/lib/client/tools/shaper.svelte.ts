// Turning and resizing a token by the handles it wears while it is the one
// thing selected: the handle above it turns it, the dot on each side
// resizes it.

import { within } from '#lib/client/stage.svelte.ts';
import type { Shaping } from '#lib/client/mapview.ts';
import { sitsOnCorner, snapToGrid } from '#lib/shared/grid.ts';
import {
	LIMITS,
	ROTATION_STEP,
	TOKEN_SIZE_STEP,
	type Point,
	type Token,
	type TokenInput
} from '#lib/shared/types.ts';
import type { Board, GestureOf } from './board.ts';

/** Which way a spot is from another, in degrees clockwise from straight up: the way a token's turn is counted. */
const bearing = ([dx, dy]: Point) => (Math.atan2(dx, -dy) * 180) / Math.PI;

export class Shaper {
	/** The token being turned or resized, and what it has come to so far. */
	now = $state.raw<Shaping | null>(null);

	#board: Board;
	/** Where a token is drawn: in a hand if it is in one, or where it stands. */
	#spotOf: (token: Token) => Point;

	constructor(board: Board, spotOf: (token: Token) => Point) {
		this.#board = board;
		this.#spotOf = spotOf;
	}

	/** How big a token is drawn, and which way round: as its handles have it, or as it is. */
	sizeOf = (token: Token) => (this.now?.id === token.id ? this.now.size : undefined) ?? token.size;
	turnOf = (token: Token) =>
		(this.now?.id === token.id ? this.now.rotation : undefined) ?? token.rotation;

	/** How far a pointer is from the middle of a token, in the map's pixels. */
	#fromMiddle(token: Token, e: PointerEvent): Point {
		const { stage, W, H } = this.#board;
		const [px, py] = stage.toMap(e.clientX, e.clientY);
		const [x, y] = this.#spotOf(token);
		return [(px - x) * W, (py - y) * H];
	}

	/**
	 * What to ask of the server for a token that has been turned or resized,
	 * or null when it is as it was. A token an even number of cells across
	 * sits where four cells meet and any other in the middle of one, so going
	 * from one to the other shifts it half a cell to sit squarely again.
	 * `free` leaves it where it is.
	 */
	#reshaped(
		token: Token,
		to: { size?: number; rotation?: number },
		free = false
	): Partial<TokenInput> | null {
		const changes: Partial<TokenInput> = {};
		if (to.rotation !== undefined && to.rotation !== token.rotation) changes.rotation = to.rotation;
		if (to.size !== undefined && to.size !== token.size) {
			changes.size = to.size;
			if (!free && sitsOnCorner(to.size) !== sitsOnCorner(token.size)) {
				[changes.x, changes.y] = snapToGrid(this.#board.map, [token.x, token.y], to.size);
			}
		}
		return Object.keys(changes).length ? changes : null;
	}

	/**
	 * A handle with the focus: the left and right arrow keys do what dragging
	 * it does, a step at a time. `side` is which side of the token a resize
	 * handle is on, so that the arrow pointing away from the token grows it.
	 */
	handleKey = (e: KeyboardEvent, token: Token, how: 'turn' | 'resize', side = 1) => {
		const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		if (e.repeat) return;
		const changes = this.#reshaped(
			token,
			how === 'turn'
				? { rotation: (token.rotation + step * ROTATION_STEP + 360) % 360 }
				: {
						size: within(
							token.size + step * side * TOKEN_SIZE_STEP,
							TOKEN_SIZE_STEP,
							LIMITS.tokenSize
						)
					}
		);
		if (changes) this.#board.send([{ t: 'token.update', id: token.id, changes }]);
	};

	/** One of the handles on a token was pressed: it is turned or resized from here until the pointer lets go. */
	press(token: Token, handle: HTMLElement, e: PointerEvent): GestureOf<'shape'> {
		const how = handle.dataset.handle === 'turn' ? 'turn' : 'resize';
		const from = this.#fromMiddle(token, e);
		const gesture: GestureOf<'shape'> = {
			type: 'shape',
			how,
			token,
			slack:
				how === 'turn'
					? bearing(from) - this.turnOf(token)
					: Math.hypot(...from) - (this.sizeOf(token) * this.#board.cell) / 2,
			bearing: bearing(from)
		};
		// A size being changed is written over the token from the first, so
		// it starts out as the size it is. A turn is read off the token.
		this.now =
			how === 'turn'
				? { id: token.id, held: true }
				: { id: token.id, size: this.sizeOf(token), held: true };
		this.#board.stage.capture(e.pointerId);
		return gesture;
	}

	drag(g: GestureOf<'shape'>, e: PointerEvent) {
		const { stage, cell } = this.#board;
		const from = this.#fromMiddle(g.token, e);
		const away = Math.hypot(...from);
		if (g.how === 'turn') {
			// It turns as far as the pointer has gone round it, a step at a
			// time, and its handle goes round with the pointer. Right over its
			// middle there is no telling which way the pointer is.
			if (away * stage.view.k >= 6) {
				const turned = Math.round((bearing(from) - g.slack) / ROTATION_STEP) * ROTATION_STEP;
				this.now = {
					id: g.token.id,
					rotation: ((turned % 360) + 360) % 360,
					swing: bearing(from) - g.bearing,
					held: true
				};
			}
		} else {
			// Its rim follows the pointer, and its middle stays where it is.
			const across = ((away - g.slack) * 2) / cell;
			const size = within(
				Math.round(across / TOKEN_SIZE_STEP) * TOKEN_SIZE_STEP,
				TOKEN_SIZE_STEP,
				LIMITS.tokenSize
			);
			this.now = { id: g.token.id, size, held: true };
		}
	}

	lift(g: GestureOf<'shape'>, e: PointerEvent, completed: boolean) {
		const shaped = this.now;
		// With Alt held, a resized token stays exactly where it is.
		const changes = shaped && completed ? this.#reshaped(g.token, shaped, e.altKey) : null;
		if (shaped && changes) {
			// Kept as it was let go until the server has changed it, so it
			// never flickers back to what it was.
			const at: Point | undefined =
				changes.x !== undefined && changes.y !== undefined ? [changes.x, changes.y] : undefined;
			const settled = { ...shaped, at, held: false };
			this.now = settled;
			this.#board.send([{ t: 'token.update', id: g.token.id, changes }]).then(() => {
				if (this.now === settled) this.now = null;
			});
		} else {
			this.now = null;
		}
	}
}
