// Read side. Everything here takes the reader's role and filters by it.

import type { Db } from './db';
import { canSeeMarker } from '../shared/rules';
import type { Crumb, HistoryEntry, MapSnapshot, Role } from '../shared/types';
import { toHistoryEntry } from './visibility';
import {
	MAP_COLUMNS,
	MARKER_COLUMNS,
	REGION_COLUMNS,
	eventFromRow,
	latestSeq,
	mapFromRow,
	markerFromRow,
	regionFromRow
} from './world';

type Row = Parameters<typeof mapFromRow>[0];

/** A map with everything on it that `role` may see, or null if it isn't in this campaign. */
export function getMapSnapshot(
	db: Db,
	campaignId: string,
	mapId: string,
	role: Role
): MapSnapshot | null {
	// One transaction, so the snapshot and its sequence number agree.
	return db.transaction((): MapSnapshot | null => {
		const mapRow = db
			.query(`SELECT ${MAP_COLUMNS} FROM maps m WHERE m.id = ? AND m.campaign_id = ?`)
			.get(mapId, campaignId) as Row | null;
		if (!mapRow) return null;

		const trail: Crumb[] = [];
		for (let row: Row | null = mapRow, depth = 0; row && depth < 64; depth++) {
			trail.unshift({ id: row.id, name: row.name });
			row = row.parent_id
				? (db.query(`SELECT ${MAP_COLUMNS} FROM maps m WHERE m.id = ?`).get(row.parent_id) as Row)
				: null;
		}

		const regions = (
			db
				.query(
					`SELECT ${REGION_COLUMNS} FROM regions r JOIN maps t ON t.id = r.target_map_id
					 WHERE r.map_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at`
				)
				.all(mapId) as Parameters<typeof regionFromRow>[0][]
		).map(regionFromRow);

		const markers = (
			db
				.query(
					`SELECT ${MARKER_COLUMNS} FROM markers k
					 WHERE k.map_id = ? AND k.deleted_at IS NULL ORDER BY k.created_at`
				)
				.all(mapId) as Parameters<typeof markerFromRow>[0][]
		)
			.map(markerFromRow)
			.filter((marker) => canSeeMarker(role, marker));

		return { map: mapFromRow(mapRow), trail, regions, markers, lastSeq: latestSeq(db, campaignId) };
	})();
}

/** Newest first. Pass `beforeSeq` to page backwards. */
export function listHistory(
	db: Db,
	campaignId: string,
	role: Role,
	options: { mapId?: string; beforeSeq?: number; limit?: number } = {}
): HistoryEntry[] {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
	const where = ['e.campaign_id = ?'];
	const args: (string | number)[] = [campaignId];
	if (options.mapId) {
		where.push('e.map_id = ?');
		args.push(options.mapId);
	}
	if (options.beforeSeq) {
		where.push('e.seq < ?');
		args.push(options.beforeSeq);
	}
	if (role !== 'gm') {
		// Narrow in SQL so paging works; `toHistoryEntry` applies the same
		// rule again and is the one that counts.
		where.push(`e.entity = 'marker' AND json_extract(coalesce(e.after, e.before), '$.kind') = 'player'`);
	}

	const rows = db
		.query(
			`SELECT e.*, coalesce(m.name, '') AS map_name FROM events e LEFT JOIN maps m ON m.id = e.map_id
			 WHERE ${where.join(' AND ')} ORDER BY e.seq DESC LIMIT ?`
		)
		.all(...args, limit) as (Parameters<typeof eventFromRow>[0] & { map_name: string })[];

	const entries: HistoryEntry[] = [];
	for (const row of rows) {
		const entry = toHistoryEntry(eventFromRow(row), role, row.map_name);
		if (entry) entries.push(entry);
	}
	return entries;
}
