// Read side. Everything here takes the reader's role and filters by it.

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db';
import { maps, markers, regions } from './schema';
import { canSeeMarker } from '../shared/rules';
import type { Crumb, MapSnapshot, Role } from '../shared/types';
import { latestSeq, mapColumns, markerColumns, regionColumns, targetMap } from './world';

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
		if (!map) return null;

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
			.where(and(eq(regions.mapId, mapId), isNull(regions.deletedAt)))
			.orderBy(regions.createdAt)
			.all();

		const markerList = tx
			.select(markerColumns)
			.from(markers)
			.where(and(eq(markers.mapId, mapId), isNull(markers.deletedAt)))
			.orderBy(markers.createdAt)
			.all()
			.filter((marker) => canSeeMarker(role, marker));

		return {
			map,
			trail,
			regions: regionList,
			markers: markerList,
			lastSeq: latestSeq(tx, campaignId)
		};
	});
}
