// What is new on a map to whoever is looking at it.
//
// A world marker the GM has revealed, a region that has come out of the
// fog: to a player these appear on the map, and it is easy to miss that
// they have. So each one glints until it has been looked at. What counts
// as new is worked out here, in the browser, from what this person had
// seen of each map the last time they were on it.
//
// That is this browser's to remember, per campaign and per person. A
// browser that has never been on a map has nothing to compare it with:
// there the whole map is new, and nothing on it glints.

/** How long something new glints on a table display, which has nobody in front of it to look. */
export const DISPLAY_GLINT = 20000;

/** What a browser has seen of a campaign: for each map, the ids of the things looked at. */
type Seen = Record<string, string[]>;

export class Discoveries {
	/** The things on this map that are new to this person, by id. */
	fresh = $state.raw<string[]>([]);

	#key: string;
	#mapId: string;
	/** What has been looked at on this map, or was there the first time it was opened. */
	#seen: Set<string>;

	/**
	 * `who` is the person looking, by user id, or anything else that tells
	 * one view of the campaign from another in the same browser. `ids` are
	 * the things on the map now that could be new: its world markers and its
	 * regions.
	 */
	constructor(campaignId: string, who: string, mapId: string, ids: string[]) {
		this.#key = `odyssey:seen:${campaignId}:${who}`;
		this.#mapId = mapId;
		const before = this.#read()[mapId];
		// A map never opened here before is new all over: that is where it starts from.
		this.#seen = new Set(before ?? ids);
		// Kept at once, so that what is revealed before the next visit is new then.
		if (!before) this.#write();
		this.update(mapId, ids);
	}

	#read(): Seen {
		try {
			const kept = JSON.parse(localStorage.getItem(this.#key) ?? '{}');
			return typeof kept === 'object' && kept !== null ? (kept as Seen) : {};
		} catch {
			// A private window may refuse, and what is kept may not be ours.
			return {};
		}
	}

	#write() {
		try {
			const kept = this.#read();
			kept[this.#mapId] = [...this.#seen];
			localStorage.setItem(this.#key, JSON.stringify(kept));
		} catch {
			// Nothing to remember it in: it lasts as long as this page does.
		}
	}

	/**
	 * The things on the map as they are now. What has come since the last
	 * look is new. What has gone is forgotten, so that it is new again if it
	 * comes back: hidden and revealed once more, or out from under fog that
	 * came down on it.
	 */
	update(mapId: string, ids: string[]) {
		if (mapId !== this.#mapId) return;
		const here = new Set(ids);
		let changed = false;
		for (const id of this.#seen) {
			if (!here.has(id)) changed = this.#seen.delete(id);
		}
		const fresh = ids.filter((id) => !this.#seen.has(id));
		if (fresh.join() !== this.fresh.join()) this.fresh = fresh;
		if (changed) this.#write();
	}

	/** One of them has been looked at, and is new no longer. */
	seen(id: string) {
		if (this.#seen.has(id)) return;
		this.#seen.add(id);
		this.fresh = this.fresh.filter((each) => each !== id);
		this.#write();
	}
}
