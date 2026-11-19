// Read side. Everything here takes the reader's role and filters by it.

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db';
import { drawings, events, maps, markers, regions, tokens } from './schema';
import { boxAround, boxWithin, partOf } from '../shared/backdrop';
import { walked } from '../shared/journey';
import { canSeeMarker, canSeeRegion, canSeeToken } from '../shared/rules';
import {
	turnsAmong,
	type Backdrop,
	type Crumb,
	type FindEntry,
	type MapInfo,
	type MapSnapshot,
	type Party,
	type Point,
	type Rect,
	type Role,
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
 * The tokens on a map that `role` may see. For a player that leaves out
 * the hidden ones, and the ones standing under the map's fog.
 */
export function tokensOn(db: Db, map: Pick<MapInfo, 'id' | 'fog'>, role: Role): Token[] {
	return db
		.select(tokenColumns)
		.from(tokens)
		.where(and(eq(tokens.mapId, map.id), isNull(tokens.deletedAt)))
		.orderBy(tokens.createdAt)
		.all()
		.filter((token) => canSeeToken(role, token, map.fog));
}

/**
 * A map as `role` is sent it. Its turn order names tokens, and a player is
 * told only of the ones they can see: `seen` is those, when the caller has
 * them at hand already.
 */
export function mapFor(db: Db, map: MapInfo, role: Role, seen?: Token[]): MapInfo {
	if (role === 'gm' || map.turns.order.length === 0) return map;
	const tokens = seen ?? tokensOn(db, map, role);
	return { ...map, turns: turnsAmong(map.turns, tokens.map((token) => token.id)) };
}

/**
 * Where the party has been on a map, read from the moves in the event log:
 * see src/lib/shared/journey.ts. The party only ever stands where players
 * may go, so what it left behind on a map is for everyone who can open it.
 */
export function journeyOn(db: Db, campaignId: string, mapId: string): Point[][] {
	const moves = db
		.select({ before: events.before, after: events.after })
		.from(events)
		.where(and(eq(events.campaignId, campaignId), eq(events.entity, 'party')))
		.orderBy(events.seq)
		.all();
	let journey: Point[][] = [];
	for (const move of moves) {
		const before = move.before as Party | null;
		const after = move.after as Party | null;
		const to: Point | null = after?.mapId === mapId ? [after.x, after.y] : null;
		journey = walked(journey, to, before?.mapId === mapId);
	}
	return journey;
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
 * Everything in a campaign the finder can take `role` to: its maps, and the
 * markers and notes on them. A player is told of none that are hidden, nor
 * of anything behind a hidden region.
 */
export function findable(db: Db, campaignId: string, role: Role): FindEntry[] {
	const all = db
		.select({ id: maps.id, parentId: maps.parentId, name: maps.name, kind: maps.kind })
		.from(maps)
		.where(eq(maps.campaignId, campaignId))
		.orderBy(maps.createdAt)
		.all();
	const byId = new Map(all.map((map) => [map.id, map]));
	const doors = db
		.select({ targetMapId: regions.targetMapId, hidden: regions.hidden })
		.from(regions)
		.innerJoin(maps, eq(maps.id, regions.mapId))
		.where(eq(maps.campaignId, campaignId))
		.all();
	const shut = new Set(doors.filter((door) => door.hidden).map((door) => door.targetMapId));

	/** The names of the maps on the way to one, and whether a hidden region is on that way. */
	const wayTo = (mapId: string) => {
		const path: string[] = [];
		let concealed = false;
		for (let id: string | null = mapId, depth = 0; id && depth < 64; depth++) {
			const map = byId.get(id);
			if (!map) break;
			path.unshift(map.name);
			if (shut.has(id)) concealed = true;
			id = map.parentId;
		}
		return { path, concealed };
	};

	const entries: FindEntry[] = [];
	const ways = new Map<string, ReturnType<typeof wayTo>>();
	for (const map of all) {
		const way = wayTo(map.id);
		ways.set(map.id, way);
		if (role !== 'gm' && way.concealed) continue;
		entries.push({
			kind: 'map',
			id: map.id,
			mapId: map.id,
			name: map.name,
			path: way.path.slice(0, -1),
			type: map.kind,
			hidden: way.concealed
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
		if (!way || !canSeeMarker(role, marker) || (role !== 'gm' && way.concealed)) continue;
		entries.push({
			kind: 'marker',
			id: marker.id,
			mapId: marker.mapId,
			name: marker.title,
			path: way.path,
			type: marker.type,
			hidden: marker.hidden || way.concealed
		});
	}
	return entries;
}

/**
 * Who can open a map of this campaign: everyone at the table, or only the
 * GM when a hidden region is on the way there. Null if there is no such map.
 */
export function audienceOf(db: Db, campaignId: string, mapId: string): 'table' | 'gm' | null {
	const map = db
		.select({ id: maps.id })
		.from(maps)
		.where(and(eq(maps.id, mapId), eq(maps.campaignId, campaignId)))
		.get();
	if (!map) return null;
	return isConcealed(db, mapId) ? 'gm' : 'table';
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

/** A map with everything on it that `role` may see, or null if it isn't in this campaign. */
export function getMapSnapshot(
	db: Db,
	campaignId: string,
	mapId: string,
	role: Role
): MapSnapshot | null {
	// One transaction, so the snapshot and its sequence number agree.
	return db.transaction((tx): MapSnapshot | null => {
		const map = tx
			.select(mapColumns)
			.from(maps)
			.where(and(eq(maps.id, mapId), eq(maps.campaignId, campaignId)))
			.get();
		// To a player, a map behind a hidden region is not there at all.
		if (!map || (role !== 'gm' && isConcealed(tx, mapId))) return null;

		const trail: Crumb[] = [];
		for (let step: typeof map | undefined = map, depth = 0; step && depth < 64; depth++) {
			trail.unshift({ id: step.id, name: step.name });
			step = step.parentId
				? tx.select(mapColumns).from(maps).where(eq(maps.id, step.parentId)).get()
				: undefined;
		}

		const regionList = tx
			.select(regionColumns)
			.from(regions)
			.innerJoin(targetMap, eq(targetMap.id, regions.targetMapId))
			.where(eq(regions.mapId, mapId))
			.orderBy(regions.createdAt)
			.all()
			.filter((region) => canSeeRegion(role, region));

		const markerList = tx
			.select(markerColumns)
			.from(markers)
			.where(and(eq(markers.mapId, mapId), isNull(markers.deletedAt)))
			.orderBy(markers.createdAt)
			.all()
			.filter((marker) => canSeeMarker(role, marker));

		const drawingList = tx
			.select(drawingColumns)
			.from(drawings)
			.where(and(eq(drawings.mapId, mapId), isNull(drawings.deletedAt)))
			.orderBy(drawings.createdAt)
			.all();

		// The party never stands where players are kept out. The check is
		// the net under that rule.
		const party = readParty(tx, campaignId);
		const tokenList = tokensOn(tx, map, role);

		return {
			map: mapFor(tx, map, role, tokenList),
			backdrop: backdropOf(tx, map),
			trail,
			regions: regionList,
			markers: markerList,
			tokens: tokenList,
			drawings: drawingList,
			party: party && (role === 'gm' || !isConcealed(tx, party.mapId)) ? party : null,
			journey: map.kind === 'world' ? journeyOn(tx, campaignId, mapId) : [],
			miles: milesOf(tx, map),
			lastSeq: latestSeq(tx, campaignId)
		};
	});
}
