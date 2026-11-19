// The browser's copy of one map: a snapshot from the server, kept current
// by applying live events on top of it.

import { walked } from '#lib/shared/journey.ts';
import type {
	Backdrop,
	Crumb,
	Drawing,
	LiveEvent,
	MapInfo,
	MapSnapshot,
	Marker,
	Party,
	Point,
	Region,
	Token
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
	/** Where the party is, on this map or any other. */
	party = $state<Party | null>(null);
	/** Where the party has been on this map: see src/lib/shared/journey.ts. */
	journey = $state.raw<Point[][]>([]);
	/**
	 * How many miles across this map is, if anything on the way here says.
	 * Like the backdrop, only the server can work it out, so it is as old
	 * as the snapshot.
	 */
	readonly miles: number | null;

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
		this.party = snapshot.party;
		this.journey = snapshot.journey;
		this.miles = snapshot.miles;
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
				this.tokens = upsert(this.tokens, patch.token);
				if (patch.turns) this.map = { ...this.map, turns: patch.turns };
				break;
			case 'token.remove':
				if (patch.mapId !== here) break;
				this.tokens = this.tokens.filter((t) => t.id !== patch.id);
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
					// Fog that moved comes with the tokens that can be seen now.
					if (patch.tokens) this.tokens = patch.tokens;
				}
				this.trail = this.trail.map((c) => (c.id === map.id ? { ...c, name: map.name } : c));
				this.regions = this.regions.map((r) =>
					r.targetMapId === map.id ? { ...r, name: map.name, kind: map.kind } : r
				);
				break;
			}
			// The party is the campaign's, so it is news on whichever map this is.
			// Where it went on this one is added to the road behind it.
			case 'party.set': {
				const to = patch.party;
				this.journey = walked(
					this.journey,
					to?.mapId === here ? [to.x, to.y] : null,
					this.party?.mapId === here
				);
				this.party = to;
			}
		}
	}
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
	return list.some((x) => x.id === item.id)
		? list.map((x) => (x.id === item.id ? item : x))
		: [...list, item];
}
