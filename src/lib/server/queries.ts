// Read side. Everything here takes who is reading, and filters by that:
// their role, and for a player, which secrets they are let in on.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { drawings, maps, markers, members, regions, tokens, users } from './schema';
import { boxAround, boxWithin, partOf } from '../shared/backdrop';
import {
	canEnterRegion,
	canSeeMarker,
	canSeeRegion,
	canSeeToken,
	forEyes,
	tokenForEyes,
	roleOf,
	type Who
} from '../shared/rules';
import {
	DEFAULT_DAY_MILES,
	turnsAmong,
	type Backdrop,
	type Crumb,
	type FindEntry,
	type Fog,
	type MapInfo,
	type MapSnapshot,
	type Marker,
	type Player,
	type Rect,
	type Region,
	type Token
} from '../shared/types';

import {
	drawingColumns,
	isConcealed,
	latestSeq,
	mapColumns,
	markerColumns,
	readParty,
	regionColumns,
	targetMap,
	tokenColumns
} from './world';

/**
 * The tokens on a map that someone may see. For a player that leaves out
 * the hidden ones they are not let in on, and the ones standing under the
 * map's fog.
 */
export function tokensOn(db: Db, map: Pick<MapInfo, 'id' | 'fog'>, who: Who): Token[] {
	return db
		.select(tokenColumns)
		.from(tokens)
		.where(and(eq(tokens.mapId, map.id), isNull(tokens.deletedAt)))
		.orderBy(tokens.createdAt)
		.all()
		.filter((token) => canSeeToken(who, token, map.fog))
		.map((token) => tokenForEyes(who, token));
}

/**
 * The markers and notes on a map that someone may see. For a player that
 * leaves out the hidden world markers they are not let in on, and the ones
 * the fog of the map still covers.
 */
export function markersOn(db: Db, map: Pick<MapInfo, 'id' | 'fog'>, who: Who): Marker[] {
	return db
		.select(markerColumns)
		.from(markers)
		.where(and(eq(markers.mapId, map.id), isNull(markers.deletedAt)))
		.orderBy(markers.createdAt)
		.all()
		.filter((marker) => canSeeMarker(who, marker, map.fog))
		.map((marker) => forEyes(who, marker));
}

/** The regions drawn on a map that someone may see, likewise. */
export function regionsOn(db: Db, map: Pick<MapInfo, 'id' | 'fog'>, who: Who): Region[] {
	return db
		.select(regionColumns)
		.from(regions)
		.innerJoin(targetMap, eq(targetMap.id, regions.targetMapId))
		.where(eq(regions.mapId, map.id))
		.orderBy(regions.createdAt)
		.all()
		.filter((region) => canSeeRegion(who, region, map.fog))
		.map((region) => forEyes(who, region));
}

/**
 * A map as someone is sent it. Its turn order names tokens, and a player is
 * told only of the ones they can see: `seen` is those, when the caller has
 * them at hand already. What each token rolled is the GM's to know.
 */
export function mapFor(db: Db, map: MapInfo, who: Who, seen?: Token[]): MapInfo {
	if (roleOf(who) === 'gm' || map.turns.order.length === 0) return map;
	const tokens = seen ?? tokensOn(db, map, who);
	return { ...map, turns: turnsAmong(map.turns, tokens.map((token) => token.id)) };
}

/** Everyone who plays in a campaign, in the order they joined. */
export function playersOf(db: Db, campaignId: string): Player[] {
	return db
		.select({ id: users.id, name: users.name })
		.from(members)
		.innerJoin(users, eq(users.id, members.userId))
		.where(and(eq(members.campaignId, campaignId), eq(members.role, 'player')))
		// Two who joined in the same instant are told apart by which row came first.
		.orderBy(members.joinedAt, sql`${members}.rowid`)
		.all();
}

/**
 * How many miles across a world map is: what the GM has said of it, or
 * worked out from the nearest map further out that has a scale, by how much
 * of that map's width the way here covers. Null when no map on the way has
 * one, and for a battle map, which is measured in feet.
 */
export function milesOf(db: Db, map: Pick<MapInfo, 'id' | 'kind' | 'miles'>): number | null {
	if (map.kind !== 'world') return null;
	if (map.miles !== null) return map.miles;
	let box: Rect = [0, 0, 1, 1];
	let id = map.id;
	for (let depth = 0; depth < 64; depth++) {
		const door = db
			.select({ points: regions.points, mapId: regions.mapId })
			.from(regions)
			.where(eq(regions.targetMapId, id))
			.get();
		if (!door) return null;
		box = boxWithin(boxAround(door.points), box);
		const outer = db.select({ miles: maps.miles }).from(maps).where(eq(maps.id, door.mapId)).get();
		if (!outer) return null;
		if (outer.miles !== null) return outer.miles * (box[2] - box[0]);
		id = door.mapId;
	}
	return null;
}

/**
 * How many miles a day's travel covers on a map: what the GM has said of
 * it, or of the nearest map further out that has a pace of its own. With
 * none on the way, a day on foot.
 */
export function dayMilesOf(db: Db, map: Pick<MapInfo, 'id' | 'dayMiles' | 'parentId'>): number {
	let step: { dayMiles: number | null; parentId: string | null } | undefined = map;
	for (let depth = 0; step && depth < 64; depth++) {
		if (step.dayMiles != null) return step.dayMiles;
		if (!step.parentId) break;
		step = db
			.select({ dayMiles: maps.dayMiles, parentId: maps.parentId })
			.from(maps)
			.where(eq(maps.id, step.parentId))
			.get();
	}
	return DEFAULT_DAY_MILES;
}

/**
 * Everything in a campaign the finder can take someone to: its maps, and
 * the markers and notes on them. A player is told of none that are hidden
 * from them, nor of anything behind a region they can't step through:
 * hidden, closed, or still under the fog.
 */
export function findable(db: Db, campaignId: string, who: Who): FindEntry[] {
	const gm = roleOf(who) === 'gm';
	const all = db
		.select({
			id: maps.id,
			parentId: maps.parentId,
			name: maps.name,
			kind: maps.kind,
			fog: maps.fog
		})
		.from(maps)
		.where(eq(maps.campaignId, campaignId))
		.orderBy(maps.createdAt)
		.all();
	const byId = new Map(all.map((map) => [map.id, map]));
	const doors = db
		.select({
			mapId: regions.mapId,
			targetMapId: regions.targetMapId,
			points: regions.points,
			hidden: regions.hidden,
			seenBy: regions.seenBy,
			closed: regions.closed
		})
		.from(regions)
		.innerJoin(maps, eq(maps.id, regions.mapId))
		.where(eq(maps.campaignId, campaignId))
		.all();
	const doorTo = new Map(doors.map((door) => [door.targetMapId, door]));
	const fogOf = (mapId: string): Fog | undefined => byId.get(mapId)?.fog;

	/**
	 * The names of the maps on the way to one, whether this person is kept
	 * out of it, and whether the table as a whole is: what the GM is told.
	 */
	const wayTo = (mapId: string) => {
		const path: string[] = [];
		let concealed = false;
		let shut = false;
		for (let id: string | null = mapId, depth = 0; id && depth < 64; depth++) {
			const map = byId.get(id);
			if (!map) break;
			path.unshift(map.name);
			const door = doorTo.get(id);
			if (door && !canEnterRegion('player', door, fogOf(door.mapId))) shut = true;
			if (door && !canEnterRegion(who, door, fogOf(door.mapId))) concealed = true;
			id = map.parentId;
		}
		return { path, concealed, shut };
	};

	const entries: FindEntry[] = [];
	const ways = new Map<string, ReturnType<typeof wayTo>>();
	for (const map of all) {
		const way = wayTo(map.id);
		ways.set(map.id, way);
		if (way.concealed) continue;
		entries.push({
			kind: 'map',
			id: map.id,
			mapId: map.id,
			name: map.name,
			path: way.path.slice(0, -1),
			type: map.kind,
			hidden: gm && way.shut
		});
	}

	const pins = db
		.select({ marker: markerColumns })
		.from(markers)
		.innerJoin(maps, eq(maps.id, markers.mapId))
		.where(and(eq(maps.campaignId, campaignId), isNull(markers.deletedAt)))
		.orderBy(markers.createdAt)
		.all();
	for (const { marker } of pins) {
		const way = ways.get(marker.mapId);
		if (!way || way.concealed || !canSeeMarker(who, marker, fogOf(marker.mapId))) continue;
		entries.push({
			kind: 'marker',
			id: marker.id,
			mapId: marker.mapId,
			name: marker.title,
			path: way.path,
			type: marker.type,
			hidden: gm && (marker.hidden || way.shut)
		});
	}
	return entries;
}

/**
 * Who can open a map of this campaign besides the GM: everyone at the table,
 * or when a region on the way there keeps the table out, the players who
 * are let in all the same, by user id. Null if there is no such map.
 */
export function audienceOf(
	db: Db,
	campaignId: string,
	mapId: string
): { table: boolean; only: string[] } | null {
	const map = db
		.select({ id: maps.id })
		.from(maps)
		.where(and(eq(maps.id, mapId), eq(maps.campaignId, campaignId)))
		.get();
	if (!map) return null;
	if (!isConcealed(db, mapId)) return { table: true, only: [] };
	const only = playersOf(db, campaignId)
		.filter((player) => !isConcealed(db, mapId, { role: 'player', userId: player.id }))
		.map((player) => player.id);
	return { table: false, only };
}

/**
 * What a map shows while it has no image of its own: the part of the image
 * of a map further out that lies under the way here. Null when no map on
 * the way has an image, and for a battle map, which is a table of its own:
 * plain paper until it is given a picture.
 *
 * It names the image of a map on the way here, which whoever can open this
 * map can open too.
 */
export function backdropOf(db: Db, map: Pick<MapInfo, 'id' | 'kind'>): Backdrop | null {
	if (map.kind !== 'world') return null;
	// The part of the map being looked at, starting with all of this one.
	let box: Rect = [0, 0, 1, 1];
	let id = map.id;
	for (let depth = 0; depth < 64; depth++) {
		const door = db
			.select({ points: regions.points, mapId: regions.mapId })
			.from(regions)
			.where(eq(regions.targetMapId, id))
			.get();
		// The first map of a campaign has nothing further out to borrow from.
		if (!door) return null;
		box = boxWithin(boxAround(door.points), box);
		const outer = db
			.select({ file: maps.imageFile, width: maps.width, height: maps.height })
			.from(maps)
			.where(eq(maps.id, door.mapId))
			.get();
		if (!outer) return null;
		// A map with an image is the size of it.
		if (outer.file) return partOf({ ...outer, file: outer.file }, box);
		id = door.mapId;
	}
	return null;
}

/** A map with everything on it that someone may see, or null if it isn't in this campaign. */
export function getMapSnapshot(
	db: Db,
	campaignId: string,
	mapId: string,
	who: Who
): MapSnapshot | null {
	// One transaction, so the snapshot and its sequence number agree.
	return db.transaction((tx): MapSnapshot | null => {
		const map = tx
			.select(mapColumns)
			.from(maps)
			.where(and(eq(maps.id, mapId), eq(maps.campaignId, campaignId)))
			.get();
		// To a player, a map behind a region they can't step through is not there at all.
		if (!map || isConcealed(tx, mapId, who)) return null;

		const trail: Crumb[] = [];
		for (let step: typeof map | undefined = map, depth = 0; step && depth < 64; depth++) {
			trail.unshift({ id: step.id, name: step.name });
			step = step.parentId
				? tx.select(mapColumns).from(maps).where(eq(maps.id, step.parentId)).get()
				: undefined;
		}

		const regionList = regionsOn(tx, map, who);
		const markerList = markersOn(tx, map, who);

		const drawingList = tx
			.select(drawingColumns)
			.from(drawings)
			.where(and(eq(drawings.mapId, mapId), isNull(drawings.deletedAt)))
			.orderBy(drawings.createdAt)
			.all();

		// The party never stands where players are kept out. The check is
		// the net under that rule.
		const party = readParty(tx, campaignId);
		const tokenList = tokensOn(tx, map, who);

		return {
			map: mapFor(tx, map, who, tokenList),
			backdrop: backdropOf(tx, map),
			trail,
			regions: regionList,
			markers: markerList,
			tokens: tokenList,
			drawings: drawingList,
			party: party && !isConcealed(tx, party.mapId, who) ? party : null,
			miles: milesOf(tx, map),
			dayMiles: dayMilesOf(tx, map),
			lastSeq: latestSeq(tx, campaignId)
		};
	});
}
