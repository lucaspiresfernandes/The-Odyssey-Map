// The pen of a battle map, which to the map is three tools: one that draws
// a line freehand, one that drags out the area of a spell, and one that
// writes. What it has made stays on the map as it was made until the server
// sends it back for good.

import { clamped } from '#lib/client/stage.svelte.ts';
import type { Writing } from '#lib/client/mapview.ts';
import { capped, templateSpan, thinOut } from '#lib/shared/drawing.ts';
import { templatePoints } from '#lib/shared/grid.ts';
import {
	DRAWING_SIZE,
	LIMITS,
	type Drawing,
	type Point,
	type TemplateKind
} from '#lib/shared/types.ts';
import type { Board, GestureOf } from './board.ts';

interface Hand {
	/** The colour it draws in, writes in and lays a template down in. */
	ink(): string;
	/** Which template it lays down. */
	shape(): TemplateKind;
	userId(): string;
	/** It has done its one thing: a shape was laid, a text was written. */
	ondone(): void;
}

export class Pen {
	/** A line being drawn, in map space. */
	stroke = $state.raw<Point[] | null>(null);
	/** The lines let go that the server hasn't answered for yet. */
	inked = $state.raw<{ points: Point[]; color: string }[]>([]);
	/**
	 * A template being dragged out: where the press began, where the pointer
	 * is, and whether Alt is keeping it off the grid.
	 */
	casting = $state.raw<{ from: Point; to: Point; free: boolean } | null>(null);
	/** The templates let go that the server hasn't answered for yet. */
	cast = $state.raw<{ kind: TemplateKind; points: [Point, Point]; color: string }[]>([]);
	/** A text being typed onto the map: a new one, or with an `id`, one being reworded. */
	writing = $state.raw<Writing | null>(null);
	/** What has been typed of it so far. Kept apart, so the box has it to the last. */
	words = $state('');

	/** When the box for it opened. */
	#writingSince = 0;
	#board: Board;
	#hand: Hand;

	constructor(board: Board, hand: Hand) {
		this.#board = board;
		this.#hand = hand;
	}

	/** The template being dragged out, as it will be kept: on the grid, unless Alt is held. */
	readonly casted = $derived.by(() => {
		const casting = this.casting;
		return (
			casting &&
			templatePoints(this.#board.map, this.#hand.shape(), casting.from, casting.to, casting.free)
		);
	});

	/** How tall the letters of the text being typed are, on screen. */
	readonly writingSize = $derived.by(() => {
		const { drawings, cell, stage } = this.#board;
		const size = drawings.find((d) => d.id === this.writing?.id)?.size ?? DRAWING_SIZE.text;
		return size * cell * stage.view.k;
	});

	// ------------------------------------------------------------- the line

	pressSketch(e: PointerEvent): GestureOf<'sketch'> {
		const { stage } = this.#board;
		this.stroke = [clamped(stage.toMap(e.clientX, e.clientY))];
		stage.capture(e.pointerId);
		return { type: 'sketch' };
	}

	dragSketch(e: PointerEvent) {
		const { stage, W, H } = this.#board;
		const stroke = this.stroke;
		if (!stroke) return;
		// A new point once the pointer has gone a couple of pixels on.
		const at = clamped(stage.toMap(e.clientX, e.clientY));
		const [lx, ly] = stroke[stroke.length - 1];
		if (Math.hypot((at[0] - lx) * W, (at[1] - ly) * H) * stage.view.k >= 2) {
			this.stroke = [...stroke, at];
		}
	}

	liftSketch(completed: boolean) {
		const drawn = this.stroke;
		this.stroke = null;
		if (drawn && completed) this.#keepStroke(drawn);
	}

	/** A line was drawn: it is thinned to what gives it its shape, and kept. */
	#keepStroke(drawn: Point[]) {
		const { W, H, stage, map, send } = this.#board;
		const ink = this.#hand.ink();
		// Thinned in the map's pixels, to within less than a pixel on screen.
		let points = capped(
			thinOut(
				drawn.map(([x, y]): Point => [x * W, y * H]),
				0.75 / stage.view.k
			),
			LIMITS.drawingPoints
		).map(([x, y]): Point => [x / W, y / H]);
		// A press that never moved is a dot.
		if (points.length === 1) points = [points[0], points[0]];
		// It stays on the map as drawn until the server sends it back for good.
		const pending = { points, color: ink };
		this.inked = [...this.inked, pending];
		send([{ t: 'drawing.create', mapId: map.id, kind: 'line', points, color: ink }]).then(() => {
			this.inked = this.inked.filter((line) => line !== pending);
		});
	}

	// ------------------------------------------------------------ the shape

	pressTemplate(e: PointerEvent): GestureOf<'template'> {
		const { stage } = this.#board;
		const at = stage.toMap(e.clientX, e.clientY);
		this.casting = { from: at, to: at, free: e.altKey };
		stage.capture(e.pointerId);
		return { type: 'template' };
	}

	dragTemplate(e: PointerEvent) {
		const casting = this.casting;
		if (!casting) return;
		const to = this.#board.stage.toMap(e.clientX, e.clientY);
		this.casting = { from: casting.from, to, free: e.altKey };
	}

	liftTemplate(completed: boolean) {
		const laid = this.casted;
		this.casting = null;
		if (laid && completed) this.#keepTemplate(laid);
	}

	/** A template was dragged out: it is kept as it came to rest, unless it has no size. */
	#keepTemplate(points: [Point, Point]) {
		const board = this.#board;
		const { W, H, stage, map } = board;
		const [a, b] = points.map(([x, y]): Point => [x * W, y * H]);
		const kind = this.#hand.shape();
		const ink = this.#hand.ink();
		const userId = this.#hand.userId();
		// Less than a few pixels of it on screen was a click, not a template.
		if (templateSpan(kind, a, b).some((span) => span * stage.view.k < 4)) return;
		// It stays on the map as dragged until the server sends it back for good.
		const pending = { kind, points, color: ink };
		this.cast = [...this.cast, pending];
		const had = new Set(board.drawings.map((drawing) => drawing.id));
		board.send([{ t: 'drawing.create', mapId: map.id, kind, points, color: ink }]).then((made) => {
			this.cast = this.cast.filter((each) => each !== pending);
			// Laid, it is what is selected: to pick the tokens inside it, slide
			// it over, or rub it out once the spell is done. Unless this person
			// has gone on to select something else in the meantime.
			const mine = board.drawings.filter(
				(drawing) => !had.has(drawing.id) && drawing.kind === kind && drawing.authorId === userId
			);
			if (made && mine.length === 1 && board.selectedIds.length === 0) {
				board.selectedIds = [mine[0].id];
			}
		});
		this.#hand.ondone();
	}

	// ------------------------------------------------------------- the text

	/** Starts a new text at `at`, or opens one that is there to be reworded. */
	write(drawing: Drawing | null, at: Point = [0, 0]) {
		this.words = drawing?.text ?? '';
		this.#writingSince = performance.now();
		this.writing = drawing
			? { id: drawing.id, at: drawing.points[0], color: drawing.color }
			: { id: null, at, color: this.#hand.ink() };
	}

	/** The text is done: kept if there is any and `keep` says so, dropped otherwise. */
	doneWriting(keep: boolean) {
		const { map, send } = this.#board;
		const written = this.writing;
		if (!written) return;
		this.writing = null;
		const text = this.words.trim();
		if (keep && text) {
			if (written.id) send([{ t: 'drawing.update', id: written.id, changes: { text } }]);
			else {
				const { at: point, color } = written;
				send([{ t: 'drawing.create', mapId: map.id, kind: 'text', points: [point], text, color }]);
			}
		}
		if (!written.id) this.#hand.ondone();
	}

	/** The box lost the focus: what is in it is kept, as if Enter had been pressed. */
	leftBox(box: HTMLInputElement) {
		// A touch screen follows a tap with a click of its own, which can land
		// beside the box that the tap just opened. That is no reason to close it.
		if (!this.words && performance.now() - this.#writingSince < 400) box.focus();
		else this.doneWriting(true);
	}
}
