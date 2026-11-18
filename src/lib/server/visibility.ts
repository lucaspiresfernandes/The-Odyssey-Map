// The only path from the event log to a client.
//
// Stored events hold full before/after snapshots, including hidden world
// markers. Nothing leaves either server without passing through one of the
// functions below, which decide what a given role is allowed to receive.

import { canSeeEvent, canSeeMarker } from '../shared/rules';
import type {
	HistoryEntry,
	LiveEvent,
	MapInfo,
	Marker,
	Patch,
	Region,
	Role,
	StoredEvent
} from '../shared/types';

/**
 * Turns an event into the change a client of this role should apply, or
 * null when the role must not learn that anything happened.
 *
 * For a player, a marker being hidden looks exactly like a delete, and a
 * marker being revealed looks exactly like a create.
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

	if (event.entity === 'region') {
		if (event.after) return { t: 'region.upsert', region: event.after as Region };
		return { t: 'region.remove', id: event.entityId, mapId: event.mapId };
	}

	return { t: 'map.upsert', map: event.after as MapInfo };
}

export function toLiveEvent(event: StoredEvent, role: Role): LiveEvent | null {
	const patch = projectEvent(event, role);
	if (!patch) return null;
	return {
		seq: event.seq,
		at: event.at,
		actor: { id: event.actorId, name: event.actorName },
		patch
	};
}

export function toHistoryEntry(event: StoredEvent, role: Role, mapName: string): HistoryEntry | null {
	if (!canSeeEvent(role, event)) return null;
	return {
		seq: event.seq,
		at: event.at,
		actorName: event.actorName,
		mapId: event.mapId,
		mapName,
		entity: event.entity,
		entityId: event.entityId,
		action: event.action,
		before: event.before,
		after: event.after,
		// Creating a map is the one change with no opposite of its own.
		canRevert: !(event.entity === 'map' && event.action === 'create')
	};
}
