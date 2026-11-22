// The GM's brush for the fog of war, on either kind of map: swept over the
// map, it clears the fog there or puts it back. What it has done shows at
// once, and is what the next sweep is made on, whether or not the server
// has answered for the last.

import { clamped } from '#lib/client/stage.svelte.ts';
import { brushMarks, brushReach, marked } from '#lib/shared/fog.ts';
import type { Fog, FogMark, Point } from '#lib/shared/types.ts';
import type { Board, GestureOf } from './board.ts';

interface Hand {
	/** The tool in hand on the map. */
	tool(): string;
	/** What it is painted with: a brush that is `round`, or `square`. */
	shape(): 'round' | 'square';
	/** How big the brush is, as a part of the map's longer side. */
	size(): number;
	/** Where the mouse is over the map, if it is. */
	cursor(): Point | null;
}

export class FogBrush {
	/** Where the brush has been swept so far, with its button still down. */
	sweep = $state.raw<Point[] | null>(null);
	/**
	 * The fog as the GM last left it, until the server has it so for
	 * everyone: the next thing done to it is done to this.
	 */
	sent = $state.raw<Fog | null>(null);

	/** What was done to the fog goes to the server one after the other: each is the whole of it. */
	#queue: Promise<unknown> = Promise.resolve();
	#board: Board;
	#hand: Hand;

	constructor(board: Board, hand: Hand) {
		this.#board = board;
		this.#hand = hand;
	}

	/** The brush is in hand: it paints as it is swept, and its outline shows what it reaches. */
	readonly brushing = $derived.by(() => {
		const tool = this.#hand.tool();
		return tool === 'reveal' || tool === 'cover';
	});
	/** How far the brush reaches across the map and down it, in map space. */
	readonly reach = $derived.by(() => {
		const { W, H } = this.#board;
		return brushReach({ width: W, height: H }, this.#hand.size());
	});
	/** The fog as this person left it, the server's answer still to come or not. */
	readonly now = $derived.by(() => this.sent ?? this.#board.map.fog);
	/** The fog as it is drawn: with the sweep being made, as it will be once the brush is lifted. */
	readonly drawn = $derived.by(() =>
		this.sweep && this.brushing
			? marked(this.now, this.#marks(this.#hand.tool() === 'cover', this.sweep))
			: this.now
	);
	/** Where the outline of the brush is: under the pointer, kept on the map. */
	readonly at = $derived.by((): Point | null => {
		if (!this.brushing) return null;
		const cursor = this.#hand.cursor();
		if (cursor) return clamped(cursor);
		return this.sweep ? this.sweep[this.sweep.length - 1] : null;
	});

	/** The marks the brush in hand leaves, swept through these spots. */
	#marks(cover: boolean, swept: Point[]): FogMark[] {
		const { W, H } = this.#board;
		return brushMarks(
			cover,
			swept,
			{ width: W, height: H },
			this.#hand.size(),
			this.#hand.shape() === 'square'
		);
	}

	/**
	 * Makes these marks on the fog. It shows at once, and is the fog the next
	 * marks are made on, whether or not the server has answered for these.
	 */
	#mark(marks: FogMark[]) {
		const { map, send } = this.#board;
		const next = marked(this.now, marks);
		// Fog that is off has nothing to clear, and comes back as it was.
		if (next === this.now) return;
		this.sent = next;
		// The marks are said even when there are none: left unsaid, the server keeps the ones it has.
		const whole = { on: next.on, clear: next.clear, marks: next.marks ?? [] };
		this.#queue = this.#queue
			.then(() => send([{ t: 'map.update', id: map.id, fog: whole }]))
			.then(() => {
				if (this.sent === next) this.sent = null;
			});
	}

	press(how: 'reveal' | 'cover', e: PointerEvent): GestureOf<'sweep'> {
		const { stage } = this.#board;
		// The brush paints from where it is put down: a press alone is a dab.
		this.sweep = [clamped(stage.toMap(e.clientX, e.clientY))];
		stage.capture(e.pointerId);
		return { type: 'sweep', how };
	}

	drag(e: PointerEvent) {
		const sweep = this.sweep;
		if (!sweep) return;
		// A new spot once the brush has gone a little of its own reach on.
		const at = clamped(this.#board.stage.toMap(e.clientX, e.clientY));
		const [lx, ly] = sweep[sweep.length - 1];
		const [rx, ry] = this.reach;
		if (Math.hypot((at[0] - lx) / rx, (at[1] - ly) / ry) >= 0.04) this.sweep = [...sweep, at];
	}

	lift(g: GestureOf<'sweep'>, completed: boolean) {
		const swept = this.sweep;
		this.sweep = null;
		if (swept && completed) this.#mark(this.#marks(g.how === 'cover', swept));
	}
}
