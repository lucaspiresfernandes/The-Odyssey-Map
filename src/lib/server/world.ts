// Every change to a campaign's world goes through this module.
//
// The app calls `perform` with the actor it authenticated and the raw command
// it received, whether that came straight from a browser or was forwarded by
// the WebSocket server. This module validates the input, checks permissions,
// writes the change, and appends one row per change to the event log, all in
// a single transaction.

import { and, eq, gt, inArray, max, or } from 'drizzle-orm';
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
	points: regions.points,
	hidden: regions.hidden
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

/**
 * True when players are kept out of this map: the region that leads to it is
 * hidden, or one further up the way there is.
 */
export function isConcealed(db: Db, mapId: string): boolean {
	let id = mapId;
	for (let depth = 0; depth < 64; depth++) {
		const door = db
			.select({ hidden: regions.hidden, mapId: regions.mapId })
			.from(regions)
			.where(eq(regions.targetMapId, id))
			.get();
		// No region leads to the root map. It is always open.
		if (!door) return false;
		if (door.hidden) return true;
		id = door.mapId;
	}
	return false;
}

// Every lookup is scoped to the actor's campaign, so an id from another
// campaign behaves exactly like an id that does not exist. So does, for a
// player, anything on a map they are kept out of.

function findMap(db: Db, actor: Actor, id: string): MapInfo {
	const map = db
		.select(mapColumns)
		.from(maps)
		.where(and(eq(maps.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	if (!map || (actor.role !== 'gm' && isConcealed(db, id))) {
		fail('not_found', 'That map does not exist.');
	}
	return map;
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
	// A player asking about a world marker they cannot see, or any marker on
	// a map they are kept out of, gets the same answer as for an id that was
	// never used.
	const secret =
		row &&
		actor.role !== 'gm' &&
		((row.marker.kind === 'world' && row.marker.hidden) || isConcealed(db, row.marker.mapId));
	if (!row || secret) fail('not_found', 'That marker does not exist.');
	return row;
}

function findRegion(db: Db, actor: Actor, id: string): Region {
	const row = db
		.select(regionColumns)
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
	const hidden = raw.hidden !== undefined && asBool(raw.hidden);

	// Each region is a doorway to a map of its own, created along with it.
	const targetId = insertMap(db, actor.campaignId, map.id, name);
	const id = newId();
	db.insert(regions)
		.values({ id, mapId: map.id, targetMapId: targetId, points, hidden, createdAt: Date.now() })
		.run();

	return [
		record(db, actor, targetId, 'map', 'create', null, readMap(db, targetId)),
		record(db, actor, map.id, 'region', 'create', null, readRegion(db, id))
	];
}

const samePoints = (a: Point[], b: Point[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Reshapes a region, hides it or reveals it, whichever of the two is asked
 * for. Its name is the name of its map, changed with `map.update`.
 */
function updateRegion(
	db: Db,
	actor: Actor,
	id: string,
	changes: { points?: unknown; hidden?: unknown }
): StoredEvent[] {
	requireWorldEdit(actor);
	const before = findRegion(db, actor, id);

	const after: Region = { ...before };
	if (changes.points !== undefined) after.points = asPoints(changes.points);
	if (changes.hidden !== undefined) after.hidden = asBool(changes.hidden);
	if (samePoints(before.points, after.points) && before.hidden === after.hidden) return [];

	db.update(regions)
		.set({ points: after.points, hidden: after.hidden })
		.where(eq(regions.id, id))
		.run();
	return [record(db, actor, before.mapId, 'region', 'update', before, after)];
}

/**
 * Deletes a region for good, and with it everything that could only be
 * reached through it: the map behind it, what is on that map, and every
 * region and map further inside. Nothing brings any of it back, which is
 * why the browser asks before sending this.
 *
 * The image files of those maps are not touched here. Whoever called
 * `perform` removes them afterwards: see `deletedMaps`.
 */
function deleteRegion(db: Db, actor: Actor, id: string): StoredEvent[] {
	requireWorldEdit(actor);
	const region = findRegion(db, actor, id);

	// The map behind the region, then the maps inside that one, and so on down.
	const doomed = [readMap(db, region.targetMapId)];
	for (let i = 0; i < doomed.length; i++) {
		doomed.push(...db.select(mapColumns).from(maps).where(eq(maps.parentId, doomed[i].id)).all());
	}
	const ids = doomed.map((map) => map.id);

	// The regions go first: they point at these maps and would hold them in
	// place. That is this region and every region drawn further inside.
	db.delete(regions).where(inArray(regions.targetMapId, ids)).run();
	// The markers on a map go with it.
	db.delete(maps).where(inArray(maps.id, ids)).run();
	// So does the past of all of it. None of it could be undone any more.
	db.delete(events)
		.where(
			or(inArray(events.mapId, ids), and(eq(events.entity, 'region'), eq(events.entityId, id)))
		)
		.run();

	return [
		record(db, actor, region.mapId, 'region', 'delete', region, null),
		...doomed.map((map) => record(db, actor, map.id, 'map', 'delete', map, null))
	];
}

/** True while nothing has been put on a map: no image, no markers, no regions. */
function isBlank(db: Db, mapId: string): boolean {
	const marker = db.select({ id: markers.id }).from(markers).where(eq(markers.mapId, mapId)).get();
	const region = db.select({ id: regions.id }).from(regions).where(eq(regions.mapId, mapId)).get();
	return !readMap(db, mapId).imageFile && !marker && !region;
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
				(n) => Number.isInteger(n) && n >= 1 && n <= LIMITS.imageSide
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
 * Creating a map has no opposite of its own, and deleting a region, with
 * the maps behind it, is for good.
 */
export function undoable(made: StoredEvent[]): number[] {
	const final = (e: StoredEvent) =>
		(e.entity === 'map' && e.action !== 'update') || (e.entity === 'region' && e.action === 'delete');
	return made.filter((e) => !final(e)).map((e) => e.seq);
}

/** The maps these changes deleted. Their image files are the caller's to remove. */
export function deletedMaps(made: StoredEvent[]): string[] {
	return made.filter((e) => e.entity === 'map' && e.action === 'delete').map((e) => e.entityId);
}

/**
 * Undoes one event from the log by performing its opposite as a new change.
 * The opposite goes through the same permission checks as any other
 * command. Reverting a revert redoes it.
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
		if (event.action === 'delete') fail('invalid', "A deleted region can't be brought back.");
		if (event.action === 'create' || event.action === 'restore') {
			// Deleting is for good, so undo only does it to a region with
			// nothing to lose: one whose map is still as empty as it was made.
			if (!isBlank(db, findRegion(db, actor, id).targetMapId)) {
				fail('conflict', "That region isn't empty any more. Delete it from the bar under the map.");
			}
			return deleteRegion(db, actor, id);
		}
		// As with markers, only what this edit changed is put back. Events
		// from before regions could be hidden have no `hidden` to compare.
		const before = event.before as Region;
		const after = event.after as Region;
		const hid = Boolean(before.hidden) !== Boolean(after.hidden);
		return updateRegion(db, actor, id, {
			points: samePoints(before.points, after.points) ? undefined : before.points,
			hidden: hid ? Boolean(before.hidden) : undefined
		});
	}

	if (event.action === 'delete') fail('invalid', "A deleted map can't be brought back.");
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
			return updateRegion(db, actor, asId(cmd.id), cmd);
		case 'region.delete':
			return deleteRegion(db, actor, asId(cmd.id));
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
