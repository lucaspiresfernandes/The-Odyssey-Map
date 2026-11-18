// Every change to a campaign's world goes through this module.
//
// The app calls `perform` with the actor it authenticated and the raw command
// it received, whether that came straight from a browser or was forwarded by
// the WebSocket server. This module validates the input, checks permissions,
// writes the change, and appends one row per change to the event log, all in
// a single transaction.

import { and, eq, gt, max } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { newId } from './ids';
import { events, maps, markers, regions } from './schema';
import { canEditMarkerKind, canEditWorld, canRemoveMarker, canSeeEvent } from '../shared/rules';
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

// -------------------------------------------------------------- selections

// The columns that make up each entity as the rest of the app knows it.
// Selecting with one of these gives a `Marker`, `Region` or `MapInfo` as is.

export const markerColumns = {
	id: markers.id,
	mapId: markers.mapId,
	kind: markers.kind,
	type: markers.type,
	title: markers.title,
	description: markers.description,
	x: markers.x,
	y: markers.y,
	hidden: markers.hidden,
	authorId: markers.authorId,
	authorName: markers.authorName,
	updatedAt: markers.updatedAt
};

/** The map a region leads to. A region takes its name from it. */
export const targetMap = alias(maps, 'target');

/** Needs `targetMap` joined on `regions.targetMapId`. */
export const regionColumns = {
	id: regions.id,
	mapId: regions.mapId,
	targetMapId: regions.targetMapId,
	name: targetMap.name,
	points: regions.points
};

export const mapColumns = {
	id: maps.id,
	campaignId: maps.campaignId,
	parentId: maps.parentId,
	name: maps.name,
	imageFile: maps.imageFile,
	width: maps.width,
	height: maps.height
};

// Every lookup is scoped to the actor's campaign, so an id from another
// campaign behaves exactly like an id that does not exist.

function findMap(db: Db, actor: Actor, id: string): MapInfo {
	const map = db
		.select(mapColumns)
		.from(maps)
		.where(and(eq(maps.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	return map ?? fail('not_found', 'That map does not exist.');
}

function findMarker(
	db: Db,
	actor: Actor,
	id: string
): { marker: Marker; deletedAt: number | null } {
	const row = db
		.select({ marker: markerColumns, deletedAt: markers.deletedAt })
		.from(markers)
		.innerJoin(maps, eq(maps.id, markers.mapId))
		.where(and(eq(markers.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	// A player asking about a world marker they cannot see gets the same
	// answer as for an id that was never used.
	if (!row || (actor.role !== 'gm' && row.marker.kind === 'world' && row.marker.hidden)) {
		fail('not_found', 'That marker does not exist.');
	}
	return row;
}

function findRegion(
	db: Db,
	actor: Actor,
	id: string
): { region: Region; deletedAt: number | null } {
	const row = db
		.select({ region: regionColumns, deletedAt: regions.deletedAt })
		.from(regions)
		.innerJoin(maps, eq(maps.id, regions.mapId))
		.innerJoin(targetMap, eq(targetMap.id, regions.targetMapId))
		.where(and(eq(regions.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	return row ?? fail('not_found', 'That region does not exist.');
}

// ------------------------------------------------------------------ events

function record(
	db: Db,
	actor: Actor,
	mapId: string,
	entity: EntityType,
	action: EventAction,
	before: StoredEvent['before'],
	after: StoredEvent['after']
): StoredEvent {
	const event = {
		campaignId: actor.campaignId,
		mapId,
		actorId: actor.userId,
		actorName: actor.name,
		at: Date.now(),
		entity,
		entityId: (after ?? before)!.id,
		action,
		before,
		after
	};
	const { seq } = db.insert(events).values(event).returning({ seq: events.seq }).get();
	return { seq, ...event };
}

/** Events newer than `seq`, across all campaigns, oldest first. */
export function eventsAfter(db: Db, seq: number, limit = 500): StoredEvent[] {
	return db.select().from(events).where(gt(events.seq, seq)).orderBy(events.seq).limit(limit).all();
}

export function latestSeq(db: Db, campaignId?: string): number {
	const row = db
		.select({ seq: max(events.seq) })
		.from(events)
		.where(campaignId ? eq(events.campaignId, campaignId) : undefined)
		.get();
	return row?.seq ?? 0;
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
	return db.select(markerColumns).from(markers).where(eq(markers.id, id)).get()!;
}

function requireMarkerEdit(actor: Actor, kind: MarkerKind) {
	if (!canEditMarkerKind(actor.role, kind)) {
		fail('forbidden', 'Only the GM can change world markers.');
	}
}

/** For deleting a marker and for bringing a deleted one back. */
function requireMarkerRemoval(actor: Actor, marker: Marker, what: 'delete' | 'restore') {
	requireMarkerEdit(actor, marker.kind);
	if (!canRemoveMarker(actor.role, actor.userId, marker)) {
		fail('forbidden', `Only ${marker.authorName} or the GM can ${what} this note.`);
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
	db.insert(markers)
		.values({
			id,
			mapId: map.id,
			kind,
			type: input.type ?? 'note',
			title: input.title,
			description: input.description ?? '',
			x: input.x,
			y: input.y,
			// Hiding is a GM tool for world markers. Table notes are always shared.
			hidden: kind === 'world' && input.hidden === true,
			authorId: actor.userId,
			authorName: actor.name,
			createdAt: now,
			updatedAt: now
		})
		.run();
	return [record(db, actor, map.id, 'marker', 'create', null, readMarker(db, id))];
}

function updateMarker(db: Db, actor: Actor, id: string, rawChanges: unknown): StoredEvent[] {
	const { marker: before, deletedAt } = findMarker(db, actor, id);
	requireMarkerEdit(actor, before.kind);
	if (deletedAt !== null) fail('conflict', 'That marker was deleted. Restore it first.');

	const changes = asMarkerChanges(rawChanges);
	if (changes.hidden !== undefined && before.kind !== 'world') {
		fail('invalid', 'Only world markers can be hidden.');
	}

	const after: Marker = { ...before, ...changes };
	const changed = (Object.keys(changes) as (keyof MarkerInput)[]).some(
		(key) => before[key] !== after[key]
	);
	if (!changed) return [];

	after.updatedAt = Date.now();
	db.update(markers)
		.set({
			type: after.type,
			title: after.title,
			description: after.description,
			x: after.x,
			y: after.y,
			hidden: after.hidden,
			updatedAt: after.updatedAt
		})
		.where(eq(markers.id, id))
		.run();
	return [record(db, actor, before.mapId, 'marker', 'update', before, after)];
}

function deleteMarker(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { marker, deletedAt } = findMarker(db, actor, id);
	requireMarkerRemoval(actor, marker, 'delete');
	if (deletedAt !== null) fail('conflict', 'That marker is already deleted.');

	// Soft delete: the row stays, so a restore brings back the same marker.
	db.update(markers).set({ deletedAt: Date.now() }).where(eq(markers.id, id)).run();
	return [record(db, actor, marker.mapId, 'marker', 'delete', marker, null)];
}

function restoreMarker(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { marker, deletedAt } = findMarker(db, actor, id);
	requireMarkerRemoval(actor, marker, 'restore');
	if (deletedAt === null) fail('conflict', 'That marker is already on the map.');

	db.update(markers).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(markers.id, id)).run();
	return [record(db, actor, marker.mapId, 'marker', 'restore', null, readMarker(db, id))];
}

// ---------------------------------------------------------- maps & regions

function requireWorldEdit(actor: Actor) {
	if (!canEditWorld(actor.role)) fail('forbidden', 'Only the GM can change maps and regions.');
}

function readMap(db: Db, id: string): MapInfo {
	return db.select(mapColumns).from(maps).where(eq(maps.id, id)).get()!;
}

function readRegion(db: Db, id: string): Region {
	return db
		.select(regionColumns)
		.from(regions)
		.innerJoin(targetMap, eq(targetMap.id, regions.targetMapId))
		.where(eq(regions.id, id))
		.get()!;
}

/** Inserts a map row. Used here for child maps and by campaign creation for the root. */
export function insertMap(db: Db, campaignId: string, parentId: string | null, name: string) {
	const id = newId();
	db.insert(maps)
		.values({ id, campaignId, parentId, name, ...DEFAULT_MAP_SIZE, createdAt: Date.now() })
		.run();
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
	db.insert(regions)
		.values({ id, mapId: map.id, targetMapId: targetId, points, createdAt: Date.now() })
		.run();

	return [
		record(db, actor, targetId, 'map', 'create', null, readMap(db, targetId)),
		record(db, actor, map.id, 'region', 'create', null, readRegion(db, id))
	];
}

const samePoints = (a: Point[], b: Point[]) => JSON.stringify(a) === JSON.stringify(b);

/** Reshapes a region. Its name is the name of its map, changed with `map.update`. */
function updateRegion(db: Db, actor: Actor, id: string, rawPoints: unknown): StoredEvent[] {
	requireWorldEdit(actor);
	const { region: before, deletedAt } = findRegion(db, actor, id);
	if (deletedAt !== null) fail('conflict', 'That region was deleted. Restore it first.');

	const after: Region = { ...before, points: asPoints(rawPoints) };
	if (samePoints(before.points, after.points)) return [];
	db.update(regions).set({ points: after.points }).where(eq(regions.id, id)).run();
	return [record(db, actor, before.mapId, 'region', 'update', before, after)];
}

function deleteRegion(db: Db, actor: Actor, id: string): StoredEvent[] {
	requireWorldEdit(actor);
	const { region, deletedAt } = findRegion(db, actor, id);
	if (deletedAt !== null) fail('conflict', 'That region is already deleted.');

	// The map behind the region is kept, so restoring the region restores
	// the way into everything that was built inside it.
	db.update(regions).set({ deletedAt: Date.now() }).where(eq(regions.id, id)).run();
	return [record(db, actor, region.mapId, 'region', 'delete', region, null)];
}

function restoreRegion(db: Db, actor: Actor, id: string): StoredEvent[] {
	requireWorldEdit(actor);
	const { region, deletedAt } = findRegion(db, actor, id);
	if (deletedAt === null) fail('conflict', 'That region is already on the map.');

	db.update(regions).set({ deletedAt: null }).where(eq(regions.id, id)).run();
	return [record(db, actor, region.mapId, 'region', 'restore', null, readRegion(db, id))];
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
	db.update(maps)
		.set({
			name: after.name,
			imageFile: after.imageFile,
			width: after.width,
			height: after.height
		})
		.where(eq(maps.id, after.id))
		.run();
	return [record(db, actor, after.id, 'map', 'update', before, after)];
}

function renameMap(db: Db, actor: Actor, id: string, rawName: unknown): StoredEvent[] {
	requireWorldEdit(actor);
	const before = findMap(db, actor, id);
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
	return db.transaction(
		(tx) => {
			requireWorldEdit(actor);
			const before = findMap(tx, actor, mapId);
			const sizeOk = [image.width, image.height].every(
				(n) => Number.isInteger(n) && n >= 1 && n <= 30000
			);
			if (!sizeOk || !IMAGE_FILE_PATTERN.test(image.file) || !image.file.startsWith(`${mapId}-`)) {
				fail('invalid', 'That image could not be used.');
			}
			return writeMap(tx, actor, before, {
				...before,
				imageFile: image.file,
				width: image.width,
				height: image.height
			});
		},
		{ behavior: 'immediate' }
	);
}

// ------------------------------------------------------------------ revert

const MARKER_FIELDS = ['type', 'title', 'description', 'x', 'y', 'hidden'] as const;

/**
 * The changes among these that `revert` can take back, as sequence numbers.
 * Creating a map is the one change with no opposite of its own.
 */
export function undoable(made: StoredEvent[]): number[] {
	return made.filter((e) => !(e.entity === 'map' && e.action === 'create')).map((e) => e.seq);
}

/**
 * Undoes one event from the log by performing its opposite as a new change.
 * Nothing is ever removed from the log, and the opposite goes through the
 * same permission checks as any other command. Reverting a revert redoes it.
 */
function revert(db: Db, actor: Actor, rawSeq: unknown): StoredEvent[] {
	if (typeof rawSeq !== 'number' || !Number.isInteger(rawSeq)) fail('invalid', 'Malformed request.');
	const event = db
		.select()
		.from(events)
		.where(and(eq(events.seq, rawSeq), eq(events.campaignId, actor.campaignId)))
		.get();
	if (!event || !canSeeEvent(actor.role, event)) {
		fail('not_found', 'That change can no longer be undone.');
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
	const current = findMap(db, actor, id);
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
	return db.transaction((tx) => run(tx, actor, input), { behavior: 'immediate' });
}
