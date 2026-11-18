// Read side. Everything here takes the reader's role and filters by it.

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db';
import { drawings, maps, markers, regions, tokens } from './schema';
import { canSeeMarker, canSeeRegion, canSeeToken } from '../shared/rules';
import type { Crumb, MapInfo, MapSnapshot, Role, Token } from '../shared/types';
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

		return {
			map,
			trail,
			regions: regionList,
			markers: markerList,
			tokens: tokensOn(tx, map, role),
			drawings: drawingList,
			party: party && (role === 'gm' || !isConcealed(tx, party.mapId)) ? party : null,
			lastSeq: latestSeq(tx, campaignId)
		};
	});
}
