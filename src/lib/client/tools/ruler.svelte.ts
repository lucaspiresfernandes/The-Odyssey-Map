// The ruler: a distance measured across a map. Dragged, it runs from one
// spot to another and is gone when it is let go. Laid along a road a click
// at a time, it bends at every click, and stays to be read once it is ended.

import { LIMITS, type Point } from '#lib/shared/types.ts';
import { dragSlack, type Board, type GestureOf } from './board.ts';

export class RulerTool {
	/**
	 * The spots the ruler runs through, the last of them under the pointer.
	 * Dragged, it has two. Null while nothing is being measured.
	 */
	measure = $state.raw<Point[] | null>(null);
	/** The ruler is being laid a click at a time: its last spot follows the pointer until it is ended. */
	routing = $state(false);

	/** When and where the last spot of such a ruler was clicked: twice in one place ends it. */
	#lastBend = { at: 0, x: 0, y: 0 };
	#board: Board;

	constructor(board: Board) {
		this.#board = board;
	}

	/** The ruler is put away, and what it measured with it. */
	putAway() {
		this.measure = null;
		this.routing = false;
	}

	/** Ends a ruler laid a click at a time. It stays on the map to be read, until the next is begun. */
	endRoute() {
		this.routing = false;
		if (!this.measure) return;
		// Its last spot was only ever under the pointer.
		const laid = this.measure.slice(0, -1);
		this.measure = laid.length >= 2 ? laid : null;
	}

	/** Takes back the last bend of a ruler being laid, or with none left, the ruler. */
	unbend() {
		const measure = this.measure;
		if (!measure) return;
		if (measure.length <= 2) {
			this.putAway();
		} else {
			this.measure = [...measure.slice(0, -2), measure[measure.length - 1]];
		}
	}

	press(e: PointerEvent): GestureOf<'measure'> {
		const at = this.#board.aim(e);
		// A ruler being laid takes this spot for its end. Otherwise a new one
		// starts here, in place of any that was left on the map to be read.
		if (this.routing && this.measure) this.measure = [...this.measure.slice(0, -1), at];
		else {
			this.routing = false;
			this.measure = [at, at];
		}
		this.#board.stage.capture(e.pointerId);
		return { type: 'measure', sx: e.clientX, sy: e.clientY, moved: false, route: this.routing };
	}

	/** The mouse moved with no button down: the end of a ruler being laid follows it between clicks. */
	hover(e: PointerEvent) {
		if (this.routing && this.measure && e.pointerType === 'mouse') {
			this.measure = [...this.measure.slice(0, -1), this.#board.aim(e)];
		}
	}

	drag(g: GestureOf<'measure'>, e: PointerEvent) {
		if (!this.measure) return;
		if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > dragSlack(e)) g.moved = true;
		if (g.moved || g.route) this.measure = [...this.measure.slice(0, -1), this.#board.aim(e)];
	}

	lift(g: GestureOf<'measure'>, e: PointerEvent, completed: boolean) {
		const now = performance.now();
		const twice =
			now - this.#lastBend.at < 400 &&
			Math.hypot(e.clientX - this.#lastBend.x, e.clientY - this.#lastBend.y) < 28;
		if (!completed || (!g.route && g.moved)) {
			// Dragged from one spot to another: it was read on the way, and is gone.
			this.putAway();
		} else if (!g.route) {
			// A click that went nowhere is where a ruler laid along a road starts.
			this.routing = true;
			this.#lastBend = { at: now, x: e.clientX, y: e.clientY };
		} else if (twice || !this.measure || this.measure.length >= LIMITS.rulerPoints) {
			this.endRoute();
		} else {
			// It bends here, and its end goes on with the pointer.
			this.measure = [...this.measure, this.measure[this.measure.length - 1]];
			this.#lastBend = { at: now, x: e.clientX, y: e.clientY };
		}
	}
}
