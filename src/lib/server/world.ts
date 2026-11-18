// Every change to a campaign's world goes through this module.
//
// Both servers (SvelteKit and the WebSocket server) call `perform` with the
// actor they authenticated and the raw command they received. This module
// validates the input, checks permissions, writes the change, and appends
// one row per change to the event log, all in a single transaction.

import type { Db } from './db';
import { newId } from './ids';
import { canEditMarkerKind, canEditWorld, canSeeEvent } from '../shared/rules';
import {
	DEFAULT_MAP_SIZE,
	LIMITS,
	MARKER_TYPE_IDS,
	type EntityType,
	type EventAction,
	type MapInfo,
	type Marker,
	type MarkerInput,
	type MarkerKind,
	type MarkerType,
	type Point,
	type Region,
	type Role,
	type StoredEvent
} from '../shared/types';

export interface Actor {
	userId: string;
	name: string;
	campaignId: string;
	role: Role;
}

export type ErrorCode = 'forbidden' | 'not_found' | 'invalid' | 'conflict';

/** A refusal that is safe to show to the person who sent the command. */
export class ActionError extends Error {
	constructor(
		public code: ErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ActionError';
	}
}

function fail(code: ErrorCode, message: string): never {
	throw new ActionError(code, message);
}

// -------------------------------------------------------------------- rows

interface MarkerRow {
	id: string;
	map_id: string;
	kind: MarkerKind;
	type: string;
	title: string;
	description: string;
	x: number;
	y: number;
	hidden: number;
	author_name: string;
	updated_at: number;
	deleted_at: number | null;
}

interface RegionRow {
	id: string;
	map_id: string;
	target_map_id: string;
	points: string;
	name: string;
	deleted_at: number | null;
}

interface MapRow {
	id: string;
	campaign_id: string;
	parent_id: string | null;
	name: string;
	image_file: string | null;
	width: number;
	height: number;
}

export function markerFromRow(r: MarkerRow): Marker {
	return {
		id: r.id,
		mapId: r.map_id,
		kind: r.kind,
		type: r.type as MarkerType,
		title: r.title,
		description: r.description,
		x: r.x,
		y: r.y,
		hidden: r.hidden === 1,
		authorName: r.author_name,
		updatedAt: r.updated_at
	};
}

export function regionFromRow(r: RegionRow): Region {
	return {
		id: r.id,
		mapId: r.map_id,
		targetMapId: r.target_map_id,
		name: r.name,
		points: JSON.parse(r.points) as Point[]
	};
}

export function mapFromRow(r: MapRow): MapInfo {
	return {
		id: r.id,
		campaignId: r.campaign_id,
		parentId: r.parent_id,
		name: r.name,
		imageFile: r.image_file,
		width: r.width,
		height: r.height
	};
}

export const MARKER_COLUMNS =
	'k.id, k.map_id, k.kind, k.type, k.title, k.description, k.x, k.y, k.hidden, k.author_name, k.updated_at, k.deleted_at';
export const REGION_COLUMNS =
	'r.id, r.map_id, r.target_map_id, r.points, r.deleted_at, t.name AS name';
export const MAP_COLUMNS = 'm.id, m.campaign_id, m.parent_id, m.name, m.image_file, m.width, m.height';

// Every lookup is scoped to the actor's campaign, so an id from another
// campaign behaves exactly like an id that does not exist.

function findMap(db: Db, actor: Actor, id: string): MapRow {
	const row = db
		.query(`SELECT ${MAP_COLUMNS} FROM maps m WHERE m.id = ? AND m.campaign_id = ?`)
		.get(id, actor.campaignId) as MapRow | null;
	return row ?? fail('not_found', 'That map does not exist.');
}

function findMarker(db: Db, actor: Actor, id: string): MarkerRow {
	const row = db
		.query(
			`SELECT ${MARKER_COLUMNS} FROM markers k JOIN maps m ON m.id = k.map_id
			 WHERE k.id = ? AND m.campaign_id = ?`
		)
		.get(id, actor.campaignId) as MarkerRow | null;
	// A player asking about a world marker they cannot see gets the same
	// answer as for an id that was never used.
	if (!row || (actor.role !== 'gm' && row.kind === 'world' && row.hidden === 1)) {
		fail('not_found', 'That marker does not exist.');
	}
	return row;
}

function findRegion(db: Db, actor: Actor, id: string): RegionRow {
	const row = db
		.query(
			`SELECT ${REGION_COLUMNS} FROM regions r
			 JOIN maps m ON m.id = r.map_id JOIN maps t ON t.id = r.target_map_id
			 WHERE r.id = ? AND m.campaign_id = ?`
		)
		.get(id, actor.campaignId) as RegionRow | null;
	return row ?? fail('not_found', 'That region does not exist.');
}

// ------------------------------------------------------------------ events

interface EventRow {
	seq: number;
	campaign_id: string;
	map_id: string;
	actor_id: string;
	actor_name: string;
	at: number;
	entity: EntityType;
	entity_id: string;
	action: EventAction;
	before: string | null;
	after: string | null;
}

export function eventFromRow(r: EventRow): StoredEvent {
	return {
		seq: r.seq,
		campaignId: r.campaign_id,
		mapId: r.map_id,
		actorId: r.actor_id,
		actorName: r.actor_name,
		at: r.at,
		entity: r.entity,
		entityId: r.entity_id,
		action: r.action,
		before: r.before ? JSON.parse(r.before) : null,
		after: r.after ? JSON.parse(r.after) : null
	};
}

function record(
	db: Db,
	actor: Actor,
	mapId: string,
	entity: EntityType,
	action: EventAction,
	before: StoredEvent['before'],
	after: StoredEvent['after']
): StoredEvent {
	const entityId = (after ?? before)!.id;
	const at = Date.now();
	const { seq } = db
		.query(
			`INSERT INTO events (campaign_id, map_id, actor_id, actor_name, at, entity, entity_id, action, before, after)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`
		)
		.get(
			actor.campaignId,
			mapId,
			actor.userId,
			actor.name,
			at,
			entity,
			entityId,
			action,
			before ? JSON.stringify(before) : null,
			after ? JSON.stringify(after) : null
		) as { seq: number };
	return {
		seq,
		campaignId: actor.campaignId,
		mapId,
		actorId: actor.userId,
		actorName: actor.name,
		at,
		entity,
		entityId,
		action,
		before,
		after
	};
}

/** Events newer than `seq`, across all campaigns, oldest first. */
export function eventsAfter(db: Db, seq: number, limit = 500): StoredEvent[] {
	const rows = db
		.query('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
		.all(seq, limit) as EventRow[];
	return rows.map(eventFromRow);
}

export function latestSeq(db: Db, campaignId?: string): number {
	const row = (
		campaignId
			? db.query('SELECT max(seq) AS seq FROM events WHERE campaign_id = ?').get(campaignId)
			: db.query('SELECT max(seq) AS seq FROM events').get()
	) as { seq: number | null };
	return row.seq ?? 0;
}

// -------------------------------------------------------------- validation

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail('invalid', 'Malformed request.');
	}
	return value as Record<string, unknown>;
}

function asId(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
		fail('invalid', 'Malformed request.');
	}
	return value;
}

function asText(value: unknown, label: string, max: number, required: boolean): string {
	if (typeof value !== 'string') fail('invalid', `${label} is missing.`);
	const text = value.trim();
	if (required && text.length === 0) fail('invalid', `${label} can't be empty.`);
	if (text.length > max) fail('invalid', `${label} is too long (${max} characters at most).`);
	return text;
}

function asCoord(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		fail('invalid', 'That position is outside the map.');
	}
	return value;
}

function asPoints(value: unknown): Point[] {
	if (!Array.isArray(value) || value.length < 3) {
		fail('invalid', 'A region needs at least three corners.');
	}
	if (value.length > LIMITS.regionPoints) {
		fail('invalid', `A region can have at most ${LIMITS.regionPoints} corners.`);
	}
	return value.map((p) => {
		if (!Array.isArray(p) || p.length !== 2) fail('invalid', 'Malformed region.');
		return [asCoord(p[0]), asCoord(p[1])] as Point;
	});
}

function asMarkerType(value: unknown): MarkerType {
	if (typeof value !== 'string' || !MARKER_TYPE_IDS.includes(value)) {
		fail('invalid', 'Unknown marker type.');
	}
	return value as MarkerType;
}

function asBool(value: unknown): boolean {
	if (typeof value !== 'boolean') fail('invalid', 'Malformed request.');
	return value;
}

/** Validates whichever marker fields are present and drops everything else. */
function asMarkerChanges(value: unknown): Partial<MarkerInput> {
	const raw = asRecord(value);
	const out: Partial<MarkerInput> = {};
	if (raw.type !== undefined) out.type = asMarkerType(raw.type);
	if (raw.title !== undefined) out.title = asText(raw.title, 'The title', LIMITS.title, true);
	if (raw.description !== undefined) {
		out.description = asText(raw.description, 'The description', LIMITS.description, false);
	}
	if (raw.x !== undefined) out.x = asCoord(raw.x);
	if (raw.y !== undefined) out.y = asCoord(raw.y);
	if (raw.hidden !== undefined) out.hidden = asBool(raw.hidden);
	return out;
}

// ----------------------------------------------------------------- markers

function readMarker(db: Db, id: string): Marker {
	const row = db.query(`SELECT ${MARKER_COLUMNS} FROM markers k WHERE k.id = ?`).get(id);
	return markerFromRow(row as MarkerRow);
}

function requireMarkerEdit(actor: Actor, kind: MarkerKind) {
	if (!canEditMarkerKind(actor.role, kind)) {
		fail('forbidden', 'Only the GM can change world markers.');
	}
}

function createMarker(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	const map = findMap(db, actor, asId(raw.mapId));
	if (raw.kind !== 'world' && raw.kind !== 'player') fail('invalid', 'Unknown marker kind.');
	const kind: MarkerKind = raw.kind;
	requireMarkerEdit(actor, kind);

	const input = asMarkerChanges(raw);
	if (input.title === undefined) fail('invalid', "The title can't be empty.");
	if (input.x === undefined || input.y === undefined) fail('invalid', 'The marker needs a position.');

	const id = newId();
	const now = Date.now();
	db.query(
		`INSERT INTO markers (id, map_id, kind, type, title, description, x, y, hidden, author_id, author_name, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		map.id,
		kind,
		input.type ?? 'note',
		input.title,
		input.description ?? '',
		input.x,
		input.y,
		// Hiding is a GM tool for world markers. Table notes are always shared.
		kind === 'world' && input.hidden === true ? 1 : 0,
		actor.userId,
		actor.name,
		now,
		now
	);
	return [record(db, actor, map.id, 'marker', 'create', null, readMarker(db, id))];
}

function updateMarker(db: Db, actor: Actor, id: string, rawChanges: unknown): StoredEvent[] {
	const row = findMarker(db, actor, id);
	requireMarkerEdit(actor, row.kind);
	if (row.deleted_at !== null) fail('conflict', 'That marker was deleted. Restore it first.');

	const before = markerFromRow(row);
	const changes = asMarkerChanges(rawChanges);
	if (changes.hidden !== undefined && row.kind !== 'world') {
		fail('invalid', 'Only world markers can be hidden.');
	}

	const after: Marker = { ...before, ...changes };
	const changed = (Object.keys(changes) as (keyof MarkerInput)[]).some(
		(key) => before[key] !== after[key]
	);
	if (!changed) return [];

	after.updatedAt = Date.now();
	db.query(
		`UPDATE markers SET type = ?, title = ?, description = ?, x = ?, y = ?, hidden = ?, updated_at = ?
		 WHERE id = ?`
	).run(
		after.type,
		after.title,
		after.description,
		after.x,
		after.y,
		after.hidden ? 1 : 0,
		after.updatedAt,
		id
	);
	return [record(db, actor, row.map_id, 'marker', 'update', before, after)];
}

function deleteMarker(db: Db, actor: Actor, id: string): StoredEvent[] {
	const row = findMarker(db, actor, id);
	requireMarkerEdit(actor, row.kind);
	if (row.deleted_at !== null) fail('conflict', 'That marker is already deleted.');

	// Soft delete: the row stays, so a restore brings back the same marker.
	db.query('UPDATE markers SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
	return [record(db, actor, row.map_id, 'marker', 'delete', markerFromRow(row), null)];
}

function restoreMarker(db: Db, actor: Actor, id: string): StoredEvent[] {
	const row = findMarker(db, actor, id);
	requireMarkerEdit(actor, row.kind);
	if (row.deleted_at === null) fail('conflict', 'That marker is already on the map.');

	db.query('UPDATE markers SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(Date.now(), id);
	return [record(db, actor, row.map_id, 'marker', 'restore', null, readMarker(db, id))];
}

// ---------------------------------------------------------- maps & regions

function requireWorldEdit(actor: Actor) {
	if (!canEditWorld(actor.role)) fail('forbidden', 'Only the GM can change maps and regions.');
}

function readMap(db: Db, id: string): MapInfo {
	const row = db.query(`SELECT ${MAP_COLUMNS} FROM maps m WHERE m.id = ?`).get(id);
	return mapFromRow(row as MapRow);
}

function readRegion(db: Db, id: string): Region {
	const row = db
		.query(
			`SELECT ${REGION_COLUMNS} FROM regions r JOIN maps t ON t.id = r.target_map_id WHERE r.id = ?`
		)
		.get(id);
	return regionFromRow(row as RegionRow);
}

/** Inserts a map row. Used here for child maps and by campaign creation for the root. */
export function insertMap(db: Db, campaignId: string, parentId: string | null, name: string) {
	const id = newId();
	db.query(
		`INSERT INTO maps (id, campaign_id, parent_id, name, width, height, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(id, campaignId, parentId, name, DEFAULT_MAP_SIZE.width, DEFAULT_MAP_SIZE.height, Date.now());
	return id;
}

function createRegion(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	requireWorldEdit(actor);
	const map = findMap(db, actor, asId(raw.mapId));
	const name = asText(raw.name, 'The name', LIMITS.name, true);
	const points = asPoints(raw.points);

	// Each region is a doorway to a map of its own, created along with it.
	const targetId = insertMap(db, actor.campaignId, map.id, name);
	const id = newId();
	db.query(
		'INSERT INTO regions (id, map_id, target_map_id, points, created_at) VALUES (?, ?, ?, ?, ?)'
	).run(id, map.id, targetId, JSON.stringify(points), Date.now());

	return [
		record(db, actor, targetId, 'map', 'create', null, readMap(db, targetId)),
		record(db, actor, map.id, 'region', 'create', null, readRegion(db, id))
	];
}

function updateRegion(db: Db, actor: Actor, id: string, rawPoints: unknown): StoredEvent[] {
	requireWorldEdit(actor);
	const row = findRegion(db, actor, id);
	if (row.deleted_at !== null) fail('conflict', 'That region was deleted. Restore it first.');

	const points = JSON.stringify(asPoints(rawPoints));
	if (points === row.points) return [];
	db.query('UPDATE regions SET points = ? WHERE id = ?').run(points, id);
	return [record(db, actor, row.map_id, 'region', 'update', regionFromRow(row), readRegion(db, id))];
}

function deleteRegion(db: Db, actor: Actor, id: string): StoredEvent[] {
	requireWorldEdit(actor);
	const row = findRegion(db, actor, id);
	if (row.deleted_at !== null) fail('conflict', 'That region is already deleted.');

	// The map behind the region is kept, so restoring the region restores
	// the way into everything that was built inside it.
	db.query('UPDATE regions SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
	return [record(db, actor, row.map_id, 'region', 'delete', regionFromRow(row), null)];
}

function restoreRegion(db: Db, actor: Actor, id: string): StoredEvent[] {
	requireWorldEdit(actor);
	const row = findRegion(db, actor, id);
	if (row.deleted_at === null) fail('conflict', 'That region is already on the map.');

	db.query('UPDATE regions SET deleted_at = NULL WHERE id = ?').run(id);
	return [record(db, actor, row.map_id, 'region', 'restore', null, readRegion(db, id))];
}

function writeMap(db: Db, actor: Actor, before: MapInfo, after: MapInfo): StoredEvent[] {
	if (
		before.name === after.name &&
		before.imageFile === after.imageFile &&
		before.width === after.width &&
		before.height === after.height
	) {
		return [];
	}
	db.query('UPDATE maps SET name = ?, image_file = ?, width = ?, height = ? WHERE id = ?').run(
		after.name,
		after.imageFile,
		after.width,
		after.height,
		after.id
	);
	return [record(db, actor, after.id, 'map', 'update', before, after)];
}

function renameMap(db: Db, actor: Actor, id: string, rawName: unknown): StoredEvent[] {
	requireWorldEdit(actor);
	const before = mapFromRow(findMap(db, actor, id));
	const name = asText(rawName, 'The name', LIMITS.name, true);
	return writeMap(db, actor, before, { ...before, name });
}

/** Naming rule for uploaded map images: `<mapId>-<random>.<ext>`. */
export const IMAGE_FILE_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9]+\.(png|jpg|gif|webp|avif)$/;

/**
 * Points a map at an image file the caller has already saved to the uploads
 * directory. Called by the SvelteKit upload endpoint.
 */
export function setMapImage(
	db: Db,
	actor: Actor,
	mapId: string,
	image: { file: string; width: number; height: number }
): StoredEvent[] {
	return db
		.transaction(() => {
			requireWorldEdit(actor);
			const before = mapFromRow(findMap(db, actor, mapId));
			const sizeOk = [image.width, image.height].every(
				(n) => Number.isInteger(n) && n >= 1 && n <= 30000
			);
			if (!sizeOk || !IMAGE_FILE_PATTERN.test(image.file) || !image.file.startsWith(`${mapId}-`)) {
				fail('invalid', 'That image could not be used.');
			}
			return writeMap(db, actor, before, {
				...before,
				imageFile: image.file,
				width: image.width,
				height: image.height
			});
		})
		.immediate();
}

// ------------------------------------------------------------------ revert

const MARKER_FIELDS = ['type', 'title', 'description', 'x', 'y', 'hidden'] as const;

/**
 * Undoes one event from the history by performing its opposite as a new
 * change. Nothing is ever removed from the log, and the opposite goes
 * through the same permission checks as any other command.
 */
function revert(db: Db, actor: Actor, rawSeq: unknown): StoredEvent[] {
	if (typeof rawSeq !== 'number' || !Number.isInteger(rawSeq)) fail('invalid', 'Malformed request.');
	const row = db
		.query('SELECT * FROM events WHERE seq = ? AND campaign_id = ?')
		.get(rawSeq, actor.campaignId) as EventRow | null;
	const event = row && eventFromRow(row);
	if (!event || !canSeeEvent(actor.role, event)) {
		fail('not_found', 'That change is not in the history.');
	}

	const id = event.entityId;
	if (event.entity === 'marker') {
		if (event.action === 'create' || event.action === 'restore') return deleteMarker(db, actor, id);
		if (event.action === 'delete') return restoreMarker(db, actor, id);
		// Put back only what this edit changed, so later edits to other
		// fields survive.
		const before = event.before as Marker;
		const after = event.after as Marker;
		const changes: Record<string, unknown> = {};
		for (const field of MARKER_FIELDS) {
			if (before[field] !== after[field]) changes[field] = before[field];
		}
		return updateMarker(db, actor, id, changes);
	}

	if (event.entity === 'region') {
		if (event.action === 'create' || event.action === 'restore') return deleteRegion(db, actor, id);
		if (event.action === 'delete') return restoreRegion(db, actor, id);
		return updateRegion(db, actor, id, (event.before as Region).points);
	}

	if (event.action !== 'update') {
		fail('invalid', "A map can't be un-created. Delete the region that leads to it instead.");
	}
	requireWorldEdit(actor);
	const old = event.before as MapInfo;
	const current = mapFromRow(findMap(db, actor, id));
	return writeMap(db, actor, current, {
		...current,
		name: old.name,
		imageFile: old.imageFile,
		width: old.width,
		height: old.height
	});
}

// ----------------------------------------------------------------- perform

function run(db: Db, actor: Actor, input: unknown): StoredEvent[] {
	const cmd = asRecord(input);
	switch (cmd.t) {
		case 'marker.create':
			return createMarker(db, actor, cmd);
		case 'marker.update':
			return updateMarker(db, actor, asId(cmd.id), cmd.changes);
		case 'marker.delete':
			return deleteMarker(db, actor, asId(cmd.id));
		case 'marker.restore':
			return restoreMarker(db, actor, asId(cmd.id));
		case 'region.create':
			return createRegion(db, actor, cmd);
		case 'region.update':
			return updateRegion(db, actor, asId(cmd.id), cmd.points);
		case 'region.delete':
			return deleteRegion(db, actor, asId(cmd.id));
		case 'region.restore':
			return restoreRegion(db, actor, asId(cmd.id));
		case 'map.update':
			return renameMap(db, actor, asId(cmd.id), cmd.name);
		case 'history.revert':
			return revert(db, actor, cmd.seq);
		default:
			fail('invalid', 'Unknown command.');
	}
}

/**
 * Applies one command from `actor` and returns the events it produced.
 * `input` is untrusted: it is whatever arrived over the network.
 * Throws `ActionError` when the command is refused.
 */
export function perform(db: Db, actor: Actor, input: unknown): StoredEvent[] {
	return db.transaction(() => run(db, actor, input)).immediate();
}
