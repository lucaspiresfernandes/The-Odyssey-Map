// The browser's copy of one map: a snapshot from the server, kept current
// by applying live events on top of it.

import type {
	Crumb,
	LiveEvent,
	MapInfo,
	MapSnapshot,
	Marker,
	Region,
	Token
} from '#lib/shared/types.ts';

export class MapState {
	map = $state() as MapInfo;
	trail = $state<Crumb[]>([]);
	regions = $state<Region[]>([]);
	markers = $state<Marker[]>([]);
	tokens = $state<Token[]>([]);

	/** Events up to this sequence number are already part of the snapshot. */
	readonly lastSeq: number;

	constructor(snapshot: MapSnapshot) {
		this.map = snapshot.map;
		this.trail = snapshot.trail;
		this.regions = snapshot.regions;
		this.markers = snapshot.markers;
		this.tokens = snapshot.tokens;
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
			case 'token.upsert':
				if (patch.token.mapId === here) this.tokens = upsert(this.tokens, patch.token);
				break;
			case 'token.remove':
				if (patch.mapId === here) this.tokens = this.tokens.filter((t) => t.id !== patch.id);
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
				if (map.id === here) this.map = map;
				this.trail = this.trail.map((c) => (c.id === map.id ? { ...c, name: map.name } : c));
				this.regions = this.regions.map((r) =>
					r.targetMapId === map.id ? { ...r, name: map.name, kind: map.kind } : r
				);
			}
		}
	}
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
	return list.some((x) => x.id === item.id)
		? list.map((x) => (x.id === item.id ? item : x))
		: [...list, item];
}
