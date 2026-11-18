// Every change to a campaign's world goes through this module.
//
// The app calls `perform` with the actor it authenticated and the raw command
// it received, whether that came straight from a browser or was forwarded by
// the WebSocket server. This module validates the input, checks permissions,
// writes the change, and appends one row per change to the event log, all in
// a single transaction.

import { and, eq, gt, inArray, isNull, max, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { newId } from './ids';
import { events, gallery, maps, markers, members, regions, tokens, users } from './schema';
import { wrapOffset } from '../shared/grid';
import {
	canEditMarkerKind,
	canEditWorld,
	canMoveToken,
	canRemoveMarker,
	canSeeEvent
} from '../shared/rules';
import {
	DEFAULT_MAP_SIZE,
	LIMITS,
	MARKER_TYPE_IDS,
	TOKEN_COLORS,
	type EntityType,
	type EventAction,
	type GalleryKind,
	type Grid,
	type MapInfo,
	type MapKind,
	type Marker,
	type MarkerInput,
	type MarkerKind,
	type MarkerType,
	type Point,
	type Region,
	type Role,
	type StoredEvent,
	type Token,
	type TokenInput
} from '../shared/types';

export interface Actor {
	userId: string;
	name: string;
	campaignId: string;
	role: Role;
}

export type ErrorCode = 'forbidden' | 'not_found' | 'invalid' | 'conflict';

/** The HTTP status that goes with each kind of refusal. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
	invalid: 400,
	forbidden: 403,
	not_found: 404,
	conflict: 409
};

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
	kind: targetMap.kind,
	points: regions.points,
	hidden: regions.hidden
};

export const mapColumns = {
	id: maps.id,
	campaignId: maps.campaignId,
	parentId: maps.parentId,
	name: maps.name,
	kind: maps.kind,
	grid: maps.grid,
	imageFile: maps.imageFile,
	width: maps.width,
	height: maps.height
};

export const tokenColumns = {
	id: tokens.id,
	mapId: tokens.mapId,
	name: tokens.name,
	color: tokens.color,
	image: tokens.image,
	x: tokens.x,
	y: tokens.y,
	size: tokens.size,
	ownerId: tokens.ownerId,
	ownerName: tokens.ownerName,
	hidden: tokens.hidden,
	updatedAt: tokens.updatedAt
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

function findToken(db: Db, actor: Actor, id: string): { token: Token; deletedAt: number | null } {
	const row = db
		.select({ token: tokenColumns, deletedAt: tokens.deletedAt })
		.from(tokens)
		.innerJoin(maps, eq(maps.id, tokens.mapId))
		.where(and(eq(tokens.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	// As with a hidden marker: to a player, a token they cannot see was never there.
	const secret =
		row && actor.role !== 'gm' && (row.token.hidden || isConcealed(db, row.token.mapId));
	if (!row || secret) fail('not_found', 'That token does not exist.');
	return row;
}

/** Naming rule for the files pictures are kept in: `<random>-<random>.<ext>`. */
export const IMAGE_FILE_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9]+\.(png|jpg|gif|webp|avif)$/;

/**
 * A picture of this campaign's that the actor may put to use, by its file
 * name. The GM may use any of them. One the GM has taken out of the gallery
 * counts for as long as it is kept: undo may be putting it back where it
 * was.
 *
 * A player picks only from what the GM has revealed in the gallery: to
 * them any other picture is the same as one that isn't there. `restoring`
 * is for undo, which puts back what was there before, whatever it was.
 */
function findPicture(
	db: Db,
	actor: Actor,
	file: string,
	kind: GalleryKind,
	restoring = false
) {
	const anyOfThem = actor.role === 'gm' || restoring;
	const picture = db
		.select({ file: gallery.file, width: gallery.width, height: gallery.height })
		.from(gallery)
		.where(
			and(
				eq(gallery.file, file),
				eq(gallery.campaignId, actor.campaignId),
				eq(gallery.kind, kind),
				anyOfThem ? undefined : and(eq(gallery.hidden, false), isNull(gallery.deletedAt))
			)
		)
		.get();
	return picture ?? fail('conflict', 'That picture is no longer in the gallery.');
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

export function asText(value: unknown, label: string, max: number, required: boolean): string {
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

function asImageFile(value: unknown): string {
	if (typeof value !== 'string' || !IMAGE_FILE_PATTERN.test(value)) {
		fail('invalid', 'That picture could not be used.');
	}
	return value;
}

function asMapKind(value: unknown): MapKind {
	if (value !== 'world' && value !== 'battle') fail('invalid', 'Unknown kind of map.');
	return value;
}

/** A grid with whichever of its settings are present changed, and checked. */
function asGrid(value: unknown, current: Grid): Grid {
	const raw = asRecord(value);
	const number = (n: unknown): number => {
		if (typeof n !== 'number' || !Number.isFinite(n)) fail('invalid', 'Malformed grid.');
		return n;
	};
	const size = raw.size === undefined ? current.size : number(raw.size);
	if (size < LIMITS.gridMin || size > LIMITS.gridMax) {
		fail('invalid', `A grid cell is between ${LIMITS.gridMin} and ${LIMITS.gridMax} pixels wide.`);
	}
	return {
		size,
		// Lines repeat every cell, so an offset is only ever part of one.
		x: wrapOffset(raw.x === undefined ? current.x : number(raw.x), size),
		y: wrapOffset(raw.y === undefined ? current.y : number(raw.y), size),
		shown: raw.shown === undefined ? current.shown : asBool(raw.shown)
	};
}

/**
 * Validates whichever token fields are present and drops everything else.
 * Who may own a token is not decided here: `ownerId` is only an id so far.
 */
function asTokenChanges(value: unknown): Partial<TokenInput> {
	const raw = asRecord(value);
	const out: Partial<TokenInput> = {};
	if (raw.name !== undefined) out.name = asText(raw.name, 'The name', LIMITS.tokenName, true);
	if (raw.color !== undefined) {
		if (!(TOKEN_COLORS as readonly unknown[]).includes(raw.color)) {
			fail('invalid', 'Unknown token colour.');
		}
		out.color = raw.color as string;
	}
	if (raw.image !== undefined) out.image = raw.image === null ? null : asImageFile(raw.image);
	if (raw.x !== undefined) out.x = asCoord(raw.x);
	if (raw.y !== undefined) out.y = asCoord(raw.y);
	if (raw.size !== undefined) {
		const size = raw.size;
		if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > LIMITS.tokenSize) {
			fail('invalid', `A token is between 1 and ${LIMITS.tokenSize} cells across.`);
		}
		out.size = size;
	}
	if (raw.ownerId !== undefined) out.ownerId = raw.ownerId === null ? null : asId(raw.ownerId);
	if (raw.hidden !== undefined) out.hidden = asBool(raw.hidden);
	return out;
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
	if (map.kind === 'battle') fail('invalid', 'Markers and notes go on world maps.');
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
	// Its map may have become a battle map since it was deleted.
	if (readMap(db, marker.mapId).kind === 'battle') {
		fail('conflict', 'That marker was on what is now a battle map, which holds none.');
	}

	db.update(markers).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(markers.id, id)).run();
	return [record(db, actor, marker.mapId, 'marker', 'restore', null, readMarker(db, id))];
}

// ------------------------------------------------------------------ tokens

function readToken(db: Db, id: string): Token {
	return db.select(tokenColumns).from(tokens).where(eq(tokens.id, id)).get()!;
}

/** For everything a token's owner may do to it: move, rename, resize, delete, restore. */
function requireTokenMove(actor: Actor, token: Token, what: string) {
	if (!canMoveToken(actor.role, actor.userId, token)) {
		const whose = token.ownerName ? `${token.ownerName} or the GM` : 'the GM';
		fail('forbidden', `Only ${whose} can ${what} this token.`);
	}
}

/** The name of the member a token is being handed to. Only the GM gets this far. */
function ownerName(db: Db, actor: Actor, userId: string): string {
	const member = db
		.select({ name: users.name })
		.from(members)
		.innerJoin(users, eq(users.id, members.userId))
		.where(and(eq(members.campaignId, actor.campaignId), eq(members.userId, userId)))
		.get();
	return member?.name ?? fail('invalid', 'That person is not at this table.');
}

function createToken(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	const map = findMap(db, actor, asId(raw.mapId));
	if (map.kind !== 'battle') fail('invalid', 'Tokens go on battle maps.');

	const input = asTokenChanges(raw);
	if (input.name === undefined) fail('invalid', "The name can't be empty.");
	if (input.x === undefined || input.y === undefined) fail('invalid', 'The token needs a position.');

	// A player adds their own piece and nothing else. The GM's tokens are the
	// GM's alone unless they are made out to someone.
	const gm = actor.role === 'gm';
	const ownerId = gm ? (input.ownerId ?? null) : actor.userId;
	// A token wears a picture out of the gallery. For a player that is one
	// the GM has revealed.
	const image = input.image ?? null;
	if (image) findPicture(db, actor, image, 'token');
	const id = newId();
	const now = Date.now();
	db.insert(tokens)
		.values({
			id,
			mapId: map.id,
			name: input.name,
			color: input.color ?? TOKEN_COLORS[0],
			image,
			x: input.x,
			y: input.y,
			size: input.size ?? 1,
			ownerId,
			ownerName: gm ? ownerId && ownerName(db, actor, ownerId) : actor.name,
			hidden: gm && input.hidden === true,
			createdAt: now,
			updatedAt: now
		})
		.run();
	return [record(db, actor, map.id, 'token', 'create', null, readToken(db, id))];
}

const TOKEN_FIELDS = ['name', 'color', 'image', 'x', 'y', 'size', 'ownerId', 'hidden'] as const;

/** `restoring` says this is undo, putting back what an earlier change took away. */
function updateToken(
	db: Db,
	actor: Actor,
	id: string,
	rawChanges: unknown,
	restoring = false
): StoredEvent[] {
	const { token: before, deletedAt } = findToken(db, actor, id);
	requireTokenMove(actor, before, 'change');
	if (deletedAt !== null) fail('conflict', 'That token was deleted. Restore it first.');

	const changes = asTokenChanges(rawChanges);
	if (actor.role !== 'gm' && (changes.hidden !== undefined || changes.ownerId !== undefined)) {
		fail('forbidden', 'Only the GM can hide a token or hand it to someone.');
	}

	const after: Token = { ...before, ...changes };
	if (!TOKEN_FIELDS.some((field) => before[field] !== after[field])) return [];
	if (after.image && after.image !== before.image) {
		// Undo may hand a player's token back a picture the GM gave it and
		// has not revealed: it is the token's own past, not a pick.
		findPicture(db, actor, after.image, 'token', restoring);
	}
	if (after.ownerId !== before.ownerId) {
		after.ownerName = after.ownerId && ownerName(db, actor, after.ownerId);
	}

	after.updatedAt = Date.now();
	db.update(tokens)
		.set({
			name: after.name,
			color: after.color,
			image: after.image,
			x: after.x,
			y: after.y,
			size: after.size,
			ownerId: after.ownerId,
			ownerName: after.ownerName,
			hidden: after.hidden,
			updatedAt: after.updatedAt
		})
		.where(eq(tokens.id, id))
		.run();
	return [record(db, actor, before.mapId, 'token', 'update', before, after)];
}

function deleteToken(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { token, deletedAt } = findToken(db, actor, id);
	requireTokenMove(actor, token, 'delete');
	if (deletedAt !== null) fail('conflict', 'That token is already deleted.');

	db.update(tokens).set({ deletedAt: Date.now() }).where(eq(tokens.id, id)).run();
	return [record(db, actor, token.mapId, 'token', 'delete', token, null)];
}

function restoreToken(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { token, deletedAt } = findToken(db, actor, id);
	requireTokenMove(actor, token, 'restore');
	if (deletedAt === null) fail('conflict', 'That token is already on the map.');

	db.update(tokens).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(tokens.id, id)).run();
	return [record(db, actor, token.mapId, 'token', 'restore', null, readToken(db, id))];
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
export function insertMap(
	db: Db,
	campaignId: string,
	parentId: string | null,
	name: string,
	kind: MapKind = 'world'
) {
	const id = newId();
	db.insert(maps)
		.values({ id, campaignId, parentId, name, kind, ...DEFAULT_MAP_SIZE, createdAt: Date.now() })
		.run();
	return id;
}

function createRegion(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	requireWorldEdit(actor);
	const map = findMap(db, actor, asId(raw.mapId));
	// A battle map is where the way down ends: nothing leads further in.
	if (map.kind === 'battle') fail('invalid', 'Regions go on world maps.');
	const name = asText(raw.name, 'The name', LIMITS.name, true);
	const points = asPoints(raw.points);
	const hidden = raw.hidden !== undefined && asBool(raw.hidden);
	const kind = raw.kind === undefined ? 'world' : asMapKind(raw.kind);

	// Each region is a doorway to a map of its own, created along with it.
	const targetId = insertMap(db, actor.campaignId, map.id, name, kind);
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
 * Their images are the gallery's and stay in it. One that was taken out of
 * the gallery and only kept for these maps can go now, which is for whoever
 * called `perform` to see to: see `deletedMaps`.
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

/** True while nothing has been put on a map: no image, no markers, no tokens, no regions. */
function isBlank(db: Db, mapId: string): boolean {
	const marker = db.select({ id: markers.id }).from(markers).where(eq(markers.mapId, mapId)).get();
	const token = db.select({ id: tokens.id }).from(tokens).where(eq(tokens.mapId, mapId)).get();
	const region = db.select({ id: regions.id }).from(regions).where(eq(regions.mapId, mapId)).get();
	return !readMap(db, mapId).imageFile && !marker && !token && !region;
}

/**
 * True when a map holds none of what a battle map can't: no markers, no
 * notes, no regions. A deleted marker doesn't count. It stays deleted.
 */
function isBare(db: Db, mapId: string): boolean {
	const marker = db
		.select({ id: markers.id })
		.from(markers)
		.where(and(eq(markers.mapId, mapId), isNull(markers.deletedAt)))
		.get();
	const region = db.select({ id: regions.id }).from(regions).where(eq(regions.mapId, mapId)).get();
	return !marker && !region;
}

const sameGrid = (a: Grid, b: Grid) =>
	a.size === b.size && a.x === b.x && a.y === b.y && a.shown === b.shown;

function writeMap(db: Db, actor: Actor, before: MapInfo, after: MapInfo): StoredEvent[] {
	if (
		before.name === after.name &&
		before.kind === after.kind &&
		sameGrid(before.grid, after.grid) &&
		before.imageFile === after.imageFile &&
		before.width === after.width &&
		before.height === after.height
	) {
		return [];
	}
	// Checked here, so that undo is held to it too: a map only ever shows a
	// picture the campaign still has.
	if (after.imageFile && after.imageFile !== before.imageFile) {
		findPicture(db, actor, after.imageFile, 'map');
	}
	// The same goes for the way back to a battle map.
	if (before.kind !== 'battle' && after.kind === 'battle' && !isBare(db, after.id)) {
		fail(
			'conflict',
			'A battle map holds no markers, notes or regions. Delete the ones on this map first.'
		);
	}
	db.update(maps)
		.set({
			name: after.name,
			kind: after.kind,
			grid: after.grid,
			imageFile: after.imageFile,
			width: after.width,
			height: after.height
		})
		.where(eq(maps.id, after.id))
		.run();
	return [record(db, actor, after.id, 'map', 'update', before, after)];
}

/**
 * Renames a map, turns it into a battle map or back into a world map, sets
 * up its grid, lays an image from the gallery under it: whichever are asked
 * for. Only a map with no markers and no regions can become a battle map,
 * since a battle map holds neither. Going back to a world map keeps the grid
 * and the tokens, out of sight, for the next time.
 */
function updateMap(
	db: Db,
	actor: Actor,
	id: string,
	changes: { name?: unknown; kind?: unknown; grid?: unknown; image?: unknown }
): StoredEvent[] {
	requireWorldEdit(actor);
	const before = findMap(db, actor, id);
	const { name, kind, grid, image } = changes;
	if ([name, kind, grid, image].every((change) => change === undefined)) {
		fail('invalid', 'Malformed request.');
	}

	const after: MapInfo = { ...before };
	if (changes.name !== undefined) after.name = asText(changes.name, 'The name', LIMITS.name, true);
	if (changes.kind !== undefined) after.kind = asMapKind(changes.kind);
	if (changes.grid !== undefined) after.grid = asGrid(changes.grid, before.grid);
	if (image !== undefined) {
		// The map takes the size of its picture. Everything on it is placed
		// in fractions of the map, so it all stays where it was.
		const picture = findPicture(db, actor, asImageFile(image), 'map');
		after.imageFile = picture.file;
		after.width = picture.width;
		after.height = picture.height;
	}
	return writeMap(db, actor, before, after);
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

/** The maps these changes deleted, which may have been the last to show some picture. */
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
	if (!event || !canSeeEvent(actor.role, actor.userId, event)) {
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

	if (event.entity === 'token') {
		if (event.action === 'create' || event.action === 'restore') return deleteToken(db, actor, id);
		if (event.action === 'delete') return restoreToken(db, actor, id);
		// Undoing a move puts the token back where it stood, and leaves a
		// rename made since alone.
		const before = event.before as Token;
		const after = event.after as Token;
		const changes: Record<string, unknown> = {};
		for (const field of TOKEN_FIELDS) {
			if (before[field] !== after[field]) changes[field] = before[field];
		}
		return updateToken(db, actor, id, changes, true);
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
		// Changes from before there were battle maps have neither of these.
		kind: old.kind ?? current.kind,
		grid: old.grid ?? current.grid,
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
			return updateMap(db, actor, asId(cmd.id), cmd);
		case 'token.create':
			return createToken(db, actor, cmd);
		case 'token.update':
			return updateToken(db, actor, asId(cmd.id), cmd.changes);
		case 'token.delete':
			return deleteToken(db, actor, asId(cmd.id));
		case 'token.restore':
			return restoreToken(db, actor, asId(cmd.id));
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
