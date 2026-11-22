// The browser's copy of one map: a snapshot from the server, kept current
// by applying live events on top of it.

import type {
	Backdrop,
	Crumb,
	Diagonal,
	Drawing,
	LiveEvent,
	MapInfo,
	MapSnapshot,
	Marker,
	Region,
	Token,
	Units
} from '#lib/shared/types.ts';

export class MapState {
	map = $state() as MapInfo;
	/**
	 * What the map shows while it has no image of its own. Only the server
	 * can work it out, so it is as old as the snapshot: the page asks for a
	 * new one when something on the way here changes.
	 */
	readonly backdrop: Backdrop | null;
	trail = $state<Crumb[]>([]);
	regions = $state<Region[]>([]);
	markers = $state<Marker[]>([]);
	tokens = $state<Token[]>([]);
	drawings = $state<Drawing[]>([]);
	/**
	 * How many miles across this map is, if anything on the way here says.
	 * Like the backdrop, only the server can work it out, so it is as old
	 * as the snapshot.
	 */
	readonly miles: number | null;
	/** How many miles a day's travel covers here: worked out by the server too, and as old as the snapshot. */
	readonly dayMiles: number;
	/**
	 * What distances are told in on the maps further out, and how a diagonal
	 * step is counted there: what this map goes by while it says nothing itself.
	 */
	readonly units: Units;
	readonly diagonal: Diagonal;

	/** Events up to this sequence number are already part of the snapshot. */
	readonly lastSeq: number;

	constructor(snapshot: MapSnapshot) {
		this.map = snapshot.map;
		this.backdrop = snapshot.backdrop;
		this.trail = snapshot.trail;
		this.regions = snapshot.regions;
		this.markers = snapshot.markers;
		this.tokens = snapshot.tokens;
		this.drawings = snapshot.drawings;
		this.miles = snapshot.miles;
		this.dayMiles = snapshot.dayMiles;
		this.units = snapshot.units;
		this.diagonal = snapshot.diagonal;
		this.lastSeq = snapshot.lastSeq;
	}

	apply(event: LiveEvent) {
		if (event.seq <= this.lastSeq) return;
		const patch = event.patch;
		const here = this.map.id;

		switch (patch.t) {
			case 'marker.upsert':
				if (patch.marker.mapId === here) this.markers = upsert(this.markers, patch.marker);
				break;
			case 'marker.remove':
				if (patch.mapId === here) this.markers = this.markers.filter((m) => m.id !== patch.id);
				break;
			// A token coming into a player's sight, or leaving it, can change
			// the turn order they are shown: it comes along then.
			case 'token.upsert':
				if (patch.token.mapId !== here) break;
				// Where the fog follows the tokens, one of the players' tokens
				// moving changes what they all see: the lot comes along then.
				this.tokens = patch.tokens ?? upsert(this.tokens, patch.token);
				if (patch.turns) this.map = { ...this.map, turns: patch.turns };
				break;
			case 'token.remove':
				if (patch.mapId !== here) break;
				this.tokens = patch.tokens ?? this.tokens.filter((t) => t.id !== patch.id);
				if (patch.turns) this.map = { ...this.map, turns: patch.turns };
				break;
			case 'drawing.upsert':
				if (patch.drawing.mapId === here) this.drawings = upsert(this.drawings, patch.drawing);
				break;
			case 'drawing.remove':
				if (patch.mapId === here) this.drawings = this.drawings.filter((d) => d.id !== patch.id);
				break;
			case 'region.upsert':
				if (patch.region.mapId === here) this.regions = upsert(this.regions, patch.region);
				break;
			case 'region.remove':
				if (patch.mapId === here) this.regions = this.regions.filter((r) => r.id !== patch.id);
				break;
			case 'map.upsert': {
				// A map's name shows up in three places: on the map itself, in
				// the trail of every map beneath it, and on the region leading to
				// it. That region says what kind of map it is, too.
				const { map } = patch;
				if (map.id === here) {
					this.map = map;
					// Fog that moved comes with what can be seen now: the tokens of
					// a battle map, the markers and regions of a world map.
					if (patch.tokens) this.tokens = patch.tokens;
					if (patch.markers) this.markers = patch.markers;
					if (patch.regions) this.regions = patch.regions;
				}
				this.trail = this.trail.map((c) => (c.id === map.id ? { ...c, name: map.name } : c));
				this.regions = this.regions.map((r) =>
					r.targetMapId === map.id ? { ...r, name: map.name, kind: map.kind } : r
				);
				break;
			}
		}
	}
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
	return list.some((x) => x.id === item.id)
		? list.map((x) => (x.id === item.id ? item : x))
		: [...list, item];
}
