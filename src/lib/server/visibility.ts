// The only path from the event log to a client.
//
// Stored events hold full before/after snapshots, including hidden world
// markers, hidden tokens, tokens under the fog and hidden regions. Nothing
// leaves the app without passing through the functions below, which decide
// what a given role is allowed to receive. That includes what is handed to
// the WebSocket server to deliver.

import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { tokensOn } from './queries';
import { maps } from './schema';
import { isConcealed } from './world';
import { canSeeMarker, canSeeRegion, canSeeToken } from '../shared/rules';
import {
	NO_FOG,
	type Drawing,
	type Fog,
	type LiveEvent,
	type MapInfo,
	type Marker,
	type Party,
	type Patch,
	type Region,
	type Role,
	type StoredEvent,
	type Token
} from '../shared/types';

/**
 * Turns an event into the change a client of this role should apply, or
 * null when the role must not learn that anything happened.
 *
 * For a player, a marker, token or region being hidden looks exactly like a
 * delete, and one being revealed looks exactly like a create. So does a
 * token going under the fog and coming out of it: `fog` is the fog on the
 * token's map, which decides that.
 */
export function projectEvent(event: StoredEvent, role: Role, fog: Fog = NO_FOG): Patch | null {
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
		if (after && canSeeToken(role, after, fog)) return { t: 'token.upsert', token: after };
		if (before && canSeeToken(role, before, fog)) {
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

	// The party is never where players are kept out, so where it is, is news for all.
	if (event.entity === 'party') {
		return { t: 'party.set', party: event.after as Party | null };
	}

	// A map is only ever deleted along with the region that led to it, and
	// the news of that region going is what tells a client.
	const map = event.after as MapInfo | null;
	return map && { t: 'map.upsert', map };
}

const fogChanged = (event: StoredEvent) =>
	event.entity === 'map' &&
	event.action === 'update' &&
	JSON.stringify((event.before as MapInfo).fog) !== JSON.stringify((event.after as MapInfo).fog);

/**
 * What a client of this role is sent about an event, if anything. Asked
 * right after the change is written: whether a map is closed to players,
 * and what its fog covers, are read from the database as it is now.
 */
export function toLiveEvent(db: Db, event: StoredEvent, role: Role): LiveEvent | null {
	// Nothing that happens on a map behind a hidden region reaches a player.
	if (role !== 'gm' && isConcealed(db, event.mapId)) return null;

	let fog: Fog | undefined;
	if (role !== 'gm' && event.entity === 'token') {
		fog = db.select({ fog: maps.fog }).from(maps).where(eq(maps.id, event.mapId)).get()?.fog;
	}
	const patch = projectEvent(event, role, fog);
	if (!patch) return null;
	// Fog that moved has uncovered some tokens for the players and covered
	// others. They are sent the lot as they may see it now.
	if (role !== 'gm' && patch.t === 'map.upsert' && fogChanged(event)) {
		patch.tokens = tokensOn(db, patch.map, role);
	}
	return {
		seq: event.seq,
		at: event.at,
		actor: { id: event.actorId, name: event.actorName },
		patch
	};
}
