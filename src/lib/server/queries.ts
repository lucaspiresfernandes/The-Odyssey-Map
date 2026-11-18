// Read side. Everything here takes the reader's role and filters by it.

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db';
import { maps, markers, regions, tokens } from './schema';
import { canSeeMarker, canSeeRegion, canSeeToken } from '../shared/rules';
import type { Crumb, MapSnapshot, Role } from '../shared/types';
import {
	isConcealed,
	latestSeq,
	mapColumns,
	markerColumns,
	regionColumns,
	targetMap,
	tokenColumns
} from './world';

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

		const tokenList = tx
			.select(tokenColumns)
			.from(tokens)
			.where(and(eq(tokens.mapId, mapId), isNull(tokens.deletedAt)))
			.orderBy(tokens.createdAt)
			.all()
			.filter((token) => canSeeToken(role, token));

		return {
			map,
			trail,
			regions: regionList,
			markers: markerList,
			tokens: tokenList,
			lastSeq: latestSeq(tx, campaignId)
		};
	});
}
