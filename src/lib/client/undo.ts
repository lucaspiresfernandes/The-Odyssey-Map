// Undo and redo for what one person did in this browser.
//
// Every change is an event with a sequence number, and the server can take
// any event back by performing its opposite as a new change. So undoing is
// asking for that, and redoing is undoing the undo: the opposite of the
// opposite. Nothing here knows what a marker or a region is.
//
// Only this person's own changes are remembered, so undo never touches what
// someone else at the table did. The server still has the last word: it
// checks permissions on an undo like on any other command.

import type { Live } from './live.svelte.ts';

/** One thing the user did: the sequence numbers of the changes it made. */
export type Step = number[];

const DEPTH = 100;

export class UndoStack {
	#live: Live;
	#done: Step[] = [];
	#undone: Step[] = [];
	/** Undos and redos run one at a time, in the order the keys were pressed. */
	#turn: Promise<unknown> = Promise.resolve();

	constructor(live: Live) {
		this.#live = live;
	}

	/**
	 * Remembers something the user just did, and returns it so it can be
	 * undone by name later. Doing something new forgets what was undone.
	 */
	did(step: Step): Step | null {
		if (step.length === 0) return null;
		this.#done.push(step);
		if (this.#done.length > DEPTH) this.#done.shift();
		this.#undone = [];
		return step;
	}

	clear() {
		this.#done = [];
		this.#undone = [];
	}

	/**
	 * Takes back the latest step, or `step` if it is still there to take
	 * back. Resolves to false when there was nothing to undo, and rejects
	 * with the server's reason when it refuses.
	 */
	undo(step?: Step): Promise<boolean> {
		return this.#queue(() => this.#rewind(this.#done, this.#undone, step));
	}

	redo(): Promise<boolean> {
		return this.#queue(() => this.#rewind(this.#undone, this.#done));
	}

	#queue(work: () => Promise<boolean>): Promise<boolean> {
		const result = this.#turn.then(work);
		this.#turn = result.catch(() => {});
		return result;
	}

	async #rewind(from: Step[], to: Step[], step = from.at(-1)): Promise<boolean> {
		const index = step ? from.lastIndexOf(step) : -1;
		if (!step || index === -1) return false;
		// Whether or not this works, the step is spent: one the server
		// refuses now, it would refuse again.
		from.splice(index, 1);

		// Newest change first, like unwinding it. A step of several changes,
		// which is something done to a whole selection, goes back as one.
		const reverts = [...step].reverse().map((seq) => ({ t: 'history.revert', seq }) as const);
		const made = await this.#live.send(
			reverts.length === 1 ? reverts[0] : { t: 'batch', cmds: reverts }
		);
		if (made.length) to.push(made);
		return true;
	}
}
