// The one line of news that floats over the bottom of a map: that something
// was done, with a way to undo it, or why it wasn't.

import type { Step } from './undo.ts';

/** What kind of news a notice is. Each kind has its own colours. */
export type NoticeType = 'success' | 'failure' | 'info' | 'warning';

export interface Notice {
	id: number;
	type: NoticeType;
	text: string;
	/** What the Undo button on the notice takes back. */
	undo?: Step | null;
}

/** How long a notice stays up, in milliseconds. */
const STAYS = 7000;

export class Notices {
	// Raw, because a notice's step is looked up in the undo stack by identity,
	// and deep state would hand out a proxy of it instead.
	now = $state.raw<Notice | null>(null);

	/** Puts a notice up, in place of the one that is. It goes again by itself. */
	say = (text: string, type: NoticeType, undo?: Step | null) => {
		const id = Date.now();
		this.now = { id, type, text, undo };
		setTimeout(() => {
			if (this.now?.id === id) this.now = null;
		}, STAYS);
	};

	dismiss = () => {
		this.now = null;
	};
}
