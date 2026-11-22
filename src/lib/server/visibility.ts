// The only path from the event log to a client.
//
// Stored events hold full before/after snapshots, including hidden world
// markers, hidden tokens and drawings, tokens under the fog or out of the
// players' sight, hidden regions, and turn orders that name tokens a player
// can't see. Nothing leaves the app
// without passing through the functions below, which decide what a given
// person is allowed to receive. That includes what is handed to
// the WebSocket server to deliver.
//
// What someone may see hangs on who they are: the GM, a player, and among
// the players the ones a hidden thing is a secret with.

import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { mapFor, markersOn, regionsOn, tokensOn } from './queries';
import { maps, regions } from './schema';
import { isConcealed, mapColumns, regionColumns, sightOn, targetMap } from './world';
import { isEye, type Sight } from '../shared/fog';
import {
	canSeeDrawing,
	canSeeMarker,
	canSeeRegion,
	canSeeToken,
	drawingForEyes,
	forEyes,
	roleOf,
	tokenForEyes,
	type Who
} from '../shared/rules';
import {
	NO_FOG,
	type Drawing,
	type Fog,
	type LiveEvent,
	type MapInfo,
	type Marker,
	type Patch,
	type Region,
	type StoredEvent,
	type Token
} from '../shared/types';

/** Two copies of a token that differ in nothing but when they were last changed. */
function sameToSee(a: Token, b: Token): boolean {
	const shown = (token: Token) =>
		JSON.stringify(
			Object.entries({ ...token, countHidden: token.countHidden ?? false, updatedAt: 0 }).sort()
		);
	return shown(a) === shown(b);
}

/**
 * Turns an event into the change this person's browser should apply, or
 * null when they must not learn that anything happened.
 *
 * For a player, a marker, token or region being hidden looks exactly like a
 * delete, and one being revealed looks exactly like a create. So does a
 * token going under the fog and coming out of it, and a secret being shared
 * with them or taken back. `fog` is the fog on the map the thing is on,
 * which decides the first of those. `sight` is what the players' tokens see
 * there now, where the fog follows the tokens: a token that walks out of
 * it is gone the same way.
 */
export function projectEvent(
	event: StoredEvent,
	who: Who,
	fog: Fog = NO_FOG,
	sight: Sight | null = null
): Patch | null {
	if (event.entity === 'marker') {
		const before = event.before as Marker | null;
		const after = event.after as Marker | null;
		if (after && canSeeMarker(who, after, fog)) {
			return { t: 'marker.upsert', marker: forEyes(who, after) };
		}
		if (before && canSeeMarker(who, before, fog)) {
			return { t: 'marker.remove', id: event.entityId, mapId: event.mapId };
		}
		return null;
	}

	if (event.entity === 'token') {
		const before = event.before as Token | null;
		const after = event.after as Token | null;
		// A token that gives the table its sight is never out of it: not where
		// it stands now, and not where it stood before it was taken away.
		const seen = (token: Token) => canSeeToken(who, token, fog, isEye(token) ? null : sight);
		if (after && seen(after)) {
			const token = tokenForEyes(who, after);
			// A number the GM keeps changing is no news to a player: the token
			// they would be sent is the one they have.
			if (
				roleOf(who) !== 'gm' &&
				event.action === 'update' &&
				before &&
				seen(before) &&
				sameToSee(tokenForEyes(who, before), token)
			) {
				return null;
			}
			return { t: 'token.upsert', token };
		}
		if (before && seen(before)) {
			return { t: 'token.remove', id: event.entityId, mapId: event.mapId };
		}
		return null;
	}

	// A drawing is in plain sight of everyone who can open its map, unless
	// the GM drew it out of theirs.
	if (event.entity === 'drawing') {
		const before = event.before as Drawing | null;
		const after = event.after as Drawing | null;
		if (after && canSeeDrawing(who, after)) {
			return { t: 'drawing.upsert', drawing: drawingForEyes(who, after) };
		}
		if (before && canSeeDrawing(who, before)) {
			return { t: 'drawing.remove', id: event.entityId, mapId: event.mapId };
		}
		return null;
	}

	if (event.entity === 'region') {
		const before = event.before as Region | null;
		const after = event.after as Region | null;
		if (after && canSeeRegion(who, after, fog)) {
			return { t: 'region.upsert', region: forEyes(who, after) };
		}
		if (before && canSeeRegion(who, before, fog)) {
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
 * A change to a map moved what covers it: its fog, or where the fog follows
 * the tokens, how far they see, which hangs on the size of a cell as well.
 */
function coverChanged(event: StoredEvent): boolean {
	if (event.entity !== 'map' || event.action !== 'update') return false;
	const before = event.before as MapInfo;
	const after = event.after as MapInfo;
	if (JSON.stringify(before.fog) !== JSON.stringify(after.fog)) return true;
	if ((before.sight ?? null) !== (after.sight ?? null)) return true;
	return (
		after.sight != null &&
		(before.cellFeet !== after.cellFeet || before.grid?.size !== after.grid?.size)
	);
}

/**
 * A change to a token moved what the players' tokens see between them: one
 * of theirs walked, came onto the map or left it, or a token became some
 * player's or stopped being one.
 */
function eyesMoved(before: Token | null, after: Token | null): boolean {
	if (isEye(before) !== isEye(after)) return true;
	return isEye(after) && (before!.x !== after!.x || before!.y !== after!.y);
}

/**
 * A map someone is kept out of was renamed. If they can see the region that
 * leads to it, the name lettered on that region is theirs to read: they are
 * sent the region again, which is all they are told.
 */
function renamedDoor(db: Db, event: StoredEvent, who: Who): Patch | null {
	if (event.entity !== 'map' || event.action !== 'update') return null;
	if ((event.before as MapInfo).name === (event.after as MapInfo).name) return null;
	const door = db
		.select({ region: regionColumns, fog: maps.fog })
		.from(regions)
		.innerJoin(targetMap, eq(targetMap.id, regions.targetMapId))
		.innerJoin(maps, eq(maps.id, regions.mapId))
		.where(eq(regions.targetMapId, event.mapId))
		.get();
	if (!door || !canSeeRegion(who, door.region, door.fog)) return null;
	if (isConcealed(db, door.region.mapId, who)) return null;
	return { t: 'region.upsert', region: forEyes(who, door.region) };
}

/**
 * What this person is sent about an event, if anything. Asked right after
 * the change is written: whether a map is closed to them, and what its fog
 * covers, are read from the database as it is now.
 */
export function toLiveEvent(db: Db, event: StoredEvent, who: Who): LiveEvent | null {
	const gm = roleOf(who) === 'gm';
	const live = (patch: Patch): LiveEvent => ({
		seq: event.seq,
		at: event.at,
		actor: { id: event.actorId, name: event.actorName },
		patch
	});

	// Nothing that happens on a map someone is kept out of reaches them, but
	// for the name of it, where they can read that on the region outside.
	if (!gm && isConcealed(db, event.mapId, who)) {
		const door = renamedDoor(db, event, who);
		return door && live(door);
	}

	// What happens to something on a map is weighed against that map: its
	// fog, and for the turn order, who else stands there.
	let home: MapInfo | undefined;
	if (!gm && (event.entity === 'token' || event.entity === 'marker' || event.entity === 'region')) {
		home = db.select(mapColumns).from(maps).where(eq(maps.id, event.mapId)).get();
	}
	// Where the fog follows the tokens: what the players' tokens see, as they stand now.
	const sight = home ? sightOn(db, home) : null;
	const patch = projectEvent(event, who, home?.fog, sight);
	if (!patch) return null;
	if (!gm && patch.t === 'map.upsert') {
		const seen = tokensOn(db, patch.map, who);
		// Fog that moved has uncovered some things for the players and covered
		// others. They are sent the lot as they may see it now.
		if (coverChanged(event)) {
			if (patch.map.kind === 'battle') patch.tokens = seen;
			else {
				patch.markers = markersOn(db, patch.map, who);
				patch.regions = regionsOn(db, patch.map, who);
			}
		}
		// Of the turn order, only the tokens they can see.
		patch.map = mapFor(db, patch.map, who, seen);
	}
	// A token that takes turns has come into a player's sight, or gone out
	// of it: the turn order they are shown changes with that.
	if (home && (patch.t === 'token.upsert' || patch.t === 'token.remove')) {
		const before = event.before as Token | null;
		if (sight && eyesMoved(before, event.after as Token | null)) {
			// One of the players' tokens moved, and what they all see moved with
			// it: other tokens came into sight, and others went out of it. They
			// are sent the lot as they may see it now, and the turn order to match.
			const seen = tokensOn(db, home, who);
			patch.tokens = seen;
			patch.turns = mapFor(db, home, who, seen).turns;
		} else {
			const wasSeen =
				!!before && canSeeToken(who, before, home.fog, isEye(before) ? null : sight);
			if ((patch.t === 'token.remove' || !wasSeen) && home.turns.order.includes(event.entityId)) {
				patch.turns = mapFor(db, home, who).turns;
			}
		}
	}
	return live(patch);
}
