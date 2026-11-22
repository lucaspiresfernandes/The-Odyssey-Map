// Showing the table a spot of the map: the pointing tool, which shows where
// the pointer is for as long as its button is held, and the ping, which
// marks a spot for a moment.

import { clamped, inside } from '#lib/client/stage.svelte.ts';
import type { Point } from '#lib/shared/types.ts';
import { dragSlack, type Board, type Gesture, type GestureOf } from './board.ts';

/**
 * How long a press with the pointing tool can last and still be a click:
 * one that went nowhere and was let go at once. Nobody would have seen
 * that pointer, so it leaves a ping behind instead.
 */
const POINT_CLICK = 250;

/** How long a finger rests on one spot before that is a ping, in milliseconds. */
const PING_PRESS = 550;

interface Hooks {
	/** The tool in hand on the map. */
	tool(): string;
	/** A table display points at nothing. */
	passive(): boolean;
	/** The press that is under way on the map. */
	gesture(): Gesture | null;
	/** This person is pointing a spot of the map out to the table. */
	onping(x: number, y: number): void;
}

export class Pointing {
	/**
	 * Where this person is pointing: where their pointer is on the map, for
	 * as long as they hold it down with the pointing tool in hand.
	 */
	at = $state.raw<Point | null>(null);

	#board: Board;
	#hooks: Hooks;

	constructor(board: Board, hooks: Hooks) {
		this.#board = board;
		this.#hooks = hooks;
	}

	/** Points a spot out to the table, if it is a spot of the map and there is a table to tell. */
	ping(clientX: number, clientY: number): boolean {
		if (this.#hooks.passive()) return false;
		const at = this.#board.stage.toMap(clientX, clientY);
		if (!inside(at)) return false;
		this.#hooks.onping(at[0], at[1]);
		return true;
	}

	/**
	 * A finger has no Alt key, so resting it on the map pings instead. If
	 * this press is still down after a moment and hasn't gone anywhere, it
	 * was that, and letting go does nothing more.
	 */
	awaitPing(e: PointerEvent, g: GestureOf<'pan' | 'grab'>) {
		if (e.pointerType === 'mouse' || this.#hooks.tool() !== 'pan' || this.#hooks.passive()) return;
		const { clientX, clientY } = e;
		setTimeout(() => {
			if (this.#hooks.gesture() !== g || g.moved) return;
			g.pinged = this.ping(clientX, clientY);
		}, PING_PRESS);
	}

	/** With the pointing tool, a press is the start of pointing: the table is shown where the pointer is until it is let go. */
	press(e: PointerEvent): GestureOf<'point'> {
		const { stage } = this.#board;
		this.at = clamped(stage.toMap(e.clientX, e.clientY));
		stage.capture(e.pointerId);
		return { type: 'point', sx: e.clientX, sy: e.clientY, at: performance.now(), moved: false };
	}

	drag(g: GestureOf<'point'>, e: PointerEvent) {
		if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > dragSlack(e)) g.moved = true;
		this.at = clamped(this.#board.stage.toMap(e.clientX, e.clientY));
	}

	lift(g: GestureOf<'point'>, e: PointerEvent, completed: boolean) {
		this.at = null;
		// Let go at once without having gone anywhere, it was a click: too
		// short for anyone to have seen, so the spot is pinged instead.
		const clicked = !g.moved && performance.now() - g.at < POINT_CLICK;
		if (clicked && completed) this.ping(e.clientX, e.clientY);
	}
}
