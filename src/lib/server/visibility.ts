// The only path from the event log to a client.
//
// Stored events hold full before/after snapshots, including hidden world
// markers, hidden tokens and hidden regions. Nothing leaves the app without passing through
// the functions below, which decide what a given role is allowed to receive.
// That includes what is handed to the WebSocket server to deliver.

import type { Db } from './db';
import { isConcealed } from './world';
import { canSeeMarker, canSeeRegion, canSeeToken } from '../shared/rules';
import type {
	Drawing,
	LiveEvent,
	MapInfo,
	Marker,
	Patch,
	Region,
	Role,
	StoredEvent,
	Token
} from '../shared/types';

/**
 * Turns an event into the change a client of this role should apply, or
 * null when the role must not learn that anything happened.
 *
 * For a player, a marker, token or region being hidden looks exactly like a
 * delete, and one being revealed looks exactly like a create.
 */
export function projectEvent(event: StoredEvent, role: Role): Patch | null {
	if (event.entity === 'marker') {
		const before = event.before as Marker | null;
		const after = event.after as Marker | null;
		if (after && canSeeMarker(role, after)) return { t: 'marker.upsert', marker: after };
		if (before && canSeeMarker(role, before)) {
			return { t: 'marker.remove', id: event.entityId, mapId: event.mapId };
		}
		return null;
	}

	if (event.entity === 'token') {
		const before = event.before as Token | null;
		const after = event.after as Token | null;
		if (after && canSeeToken(role, after)) return { t: 'token.upsert', token: after };
		if (before && canSeeToken(role, before)) {
			return { t: 'token.remove', id: event.entityId, mapId: event.mapId };
		}
		return null;
	}

	// A drawing is in plain sight of everyone who can open its map.
	if (event.entity === 'drawing') {
		const after = event.after as Drawing | null;
		return after
			? { t: 'drawing.upsert', drawing: after }
			: { t: 'drawing.remove', id: event.entityId, mapId: event.mapId };
	}

	if (event.entity === 'region') {
		const before = event.before as Region | null;
		const after = event.after as Region | null;
		if (after && canSeeRegion(role, after)) return { t: 'region.upsert', region: after };
		if (before && canSeeRegion(role, before)) {
			return {
				t: 'region.remove',
				id: event.entityId,
				mapId: event.mapId,
				targetMapId: before.targetMapId
			};
		}
		return null;
	}

	// A map is only ever deleted along with the region that led to it, and
	// the news of that region going is what tells a client.
	const map = event.after as MapInfo | null;
	return map && { t: 'map.upsert', map };
}

/**
 * What a client of this role is sent about an event, if anything. Asked
 * right after the change is written: whether a map is closed to players is
 * read from the database as it is now.
 */
export function toLiveEvent(db: Db, event: StoredEvent, role: Role): LiveEvent | null {
	// Nothing that happens on a map behind a hidden region reaches a player.
	if (role !== 'gm' && isConcealed(db, event.mapId)) return null;
	const patch = projectEvent(event, role);
	if (!patch) return null;
	return {
		seq: event.seq,
		at: event.at,
		actor: { id: event.actorId, name: event.actorName },
		patch
	};
}
