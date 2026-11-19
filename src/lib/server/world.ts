// Every change to a campaign's world goes through this module.
//
// The app calls `perform` with the actor it authenticated and the raw command
// it received, whether that came straight from a browser or was forwarded by
// the WebSocket server. This module validates the input, checks permissions,
// writes the change, and appends one row per change to the event log, all in
// a single transaction.

import { and, count, eq, gt, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { newId } from './ids';
import {
	drawings,
	events,
	gallery,
	maps,
	markers,
	members,
	parties,
	regions,
	tokens
} from './schema';
import { isFogged, middleOf, sighted, stopsBetween } from '../shared/fog';
import { wrapOffset } from '../shared/grid';
import {
	canChangeDrawing,
	canEditMarkerKind,
	canEditWorld,
	canEnterRegion,
	canHideToken,
	canMoveParty,
	canRemoveMarker,
	canRestoreToken,
	canSeeEvent,
	canSeeMarker,
	canSeeToken,
	roleOf,
	type Who
} from '../shared/rules';
import { nextTurn } from '../shared/turns';
import {
	DEFAULT_MAP_SIZE,
	DRAWING_SIZE,
	INK_COLORS,
	LIMITS,
	MARKER_TYPE_IDS,
	ROTATION_STEP,
	TOKEN_COLORS,
	TOKEN_MARK_IDS,
	TOKEN_SIZE_STEP,
	isTemplate,
	type Drawing,
	type DrawingKind,
	type EntityType,
	type EventAction,
	type Fog,
	type GalleryKind,
	type Grid,
	type MapInfo,
	type MapKind,
	type Marker,
	type MarkerInput,
	type MarkerKind,
	type MarkerType,
	type Oval,
	type Party,
	type Point,
	type Rect,
	type Region,
	type Role,
	type StoredEvent,
	type Token,
	type TokenInput,
	type TokenMark,
	type Turns,
	type Viewer
} from '../shared/types';

export interface Actor {
	userId: string;
	name: string;
	campaignId: string;
	role: Role;
}

/** The actor as someone looking at the world: what they may see hangs on who they are. */
export const viewerOf = (actor: Actor): Viewer => ({ role: actor.role, userId: actor.userId });

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
	seenBy: markers.seenBy,
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
	hidden: regions.hidden,
	seenBy: regions.seenBy,
	closed: regions.closed
};

export const mapColumns = {
	id: maps.id,
	campaignId: maps.campaignId,
	parentId: maps.parentId,
	name: maps.name,
	kind: maps.kind,
	grid: maps.grid,
	cellFeet: maps.cellFeet,
	fog: maps.fog,
	turns: maps.turns,
	miles: maps.miles,
	imageFile: maps.imageFile,
	width: maps.width,
	height: maps.height
};

export const tokenColumns = {
	id: tokens.id,
	mapId: tokens.mapId,
	name: tokens.name,
	color: tokens.color,
	outline: tokens.outline,
	image: tokens.image,
	x: tokens.x,
	y: tokens.y,
	size: tokens.size,
	rotation: tokens.rotation,
	locked: tokens.locked,
	marks: tokens.marks,
	count: tokens.count,
	hidden: tokens.hidden,
	seenBy: tokens.seenBy,
	updatedAt: tokens.updatedAt
};

export const drawingColumns = {
	id: drawings.id,
	mapId: drawings.mapId,
	kind: drawings.kind,
	points: drawings.points,
	text: drawings.text,
	color: drawings.color,
	size: drawings.size,
	authorId: drawings.authorId,
	authorName: drawings.authorName,
	updatedAt: drawings.updatedAt
};

/** The map a region is drawn on: the fog there can keep the region out of sight. */
const outerMap = alias(maps, 'outer');

/**
 * The regions on the way to a map, the one that leads to it first and the
 * one drawn on the first map of the campaign last. Each comes with the fog
 * of the map it is drawn on.
 */
export function doorsTo(db: Db, mapId: string) {
	const doors = [];
	let id = mapId;
	for (let depth = 0; depth < 64; depth++) {
		const door = db
			.select({
				id: regions.id,
				mapId: regions.mapId,
				targetMapId: regions.targetMapId,
				points: regions.points,
				hidden: regions.hidden,
				seenBy: regions.seenBy,
				closed: regions.closed,
				fog: outerMap.fog
			})
			.from(regions)
			.innerJoin(outerMap, eq(outerMap.id, regions.mapId))
			.where(eq(regions.targetMapId, id))
			.get();
		// No region leads to the root map. It is always open.
		if (!door) break;
		doors.push(door);
		id = door.mapId;
	}
	return doors;
}

/**
 * True when someone is kept out of this map: a region on the way to it is
 * hidden from them, closed, or still under the fog of the map it is drawn
 * on. Nothing is kept from the GM. With nobody named, it is asked of a
 * player who is let in on no secret: what the whole table may open.
 */
export function isConcealed(db: Db, mapId: string, who: Who = 'player'): boolean {
	if (roleOf(who) === 'gm') return false;
	return doorsTo(db, mapId).some((door) => !canEnterRegion(who, door, door.fog));
}

/**
 * True when some player is kept out of this map by the GM's own hand: a
 * region on the way is hidden, even if a few are let in on it, or closed.
 * Fog doesn't count. The party lifts that by going there.
 */
function isShut(db: Db, mapId: string): boolean {
	return doorsTo(db, mapId).some((door) => door.hidden || door.closed);
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
	if (!map || isConcealed(db, id, viewerOf(actor))) {
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
		.select({ marker: markerColumns, deletedAt: markers.deletedAt, fog: maps.fog })
		.from(markers)
		.innerJoin(maps, eq(maps.id, markers.mapId))
		.where(and(eq(markers.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	// A player asking about a world marker they cannot see, or any marker on
	// a map they are kept out of, gets the same answer as for an id that was
	// never used.
	const viewer = viewerOf(actor);
	const secret =
		row &&
		(!canSeeMarker(viewer, row.marker, row.fog) || isConcealed(db, row.marker.mapId, viewer));
	if (!row || secret) fail('not_found', 'That marker does not exist.');
	return { marker: row.marker, deletedAt: row.deletedAt };
}

function findToken(db: Db, actor: Actor, id: string): { token: Token; deletedAt: number | null } {
	const row = db
		.select({ token: tokenColumns, deletedAt: tokens.deletedAt, fog: maps.fog })
		.from(tokens)
		.innerJoin(maps, eq(maps.id, tokens.mapId))
		.where(and(eq(tokens.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	// As with a hidden marker: to a player, a token they cannot see was never
	// there. That goes for one under the fog as well.
	const viewer = viewerOf(actor);
	const secret =
		row && (!canSeeToken(viewer, row.token, row.fog) || isConcealed(db, row.token.mapId, viewer));
	if (!row || secret) fail('not_found', 'That token does not exist.');
	return { token: row.token, deletedAt: row.deletedAt };
}

/**
 * A player puts a token only where they can see: one that went under the
 * fog would be lost to them. The GM puts them anywhere.
 */
function requireInSight(actor: Actor, fog: Fog, x: number, y: number) {
	if (actor.role !== 'gm' && isFogged(fog, [x, y])) {
		fail('conflict', 'That spot is under the fog.');
	}
}

function findDrawing(
	db: Db,
	actor: Actor,
	id: string
): { drawing: Drawing; deletedAt: number | null } {
	const row = db
		.select({ drawing: drawingColumns, deletedAt: drawings.deletedAt })
		.from(drawings)
		.innerJoin(maps, eq(maps.id, drawings.mapId))
		.where(and(eq(drawings.id, id), eq(maps.campaignId, actor.campaignId)))
		.get();
	const secret = row && isConcealed(db, row.drawing.mapId, viewerOf(actor));
	if (!row || secret) fail('not_found', 'That drawing does not exist.');
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

/**
 * The players a hidden thing is a secret with, by user id: each of them
 * once, and each a player of this campaign.
 */
function asSeenBy(db: Db, actor: Actor, value: unknown): string[] {
	if (!Array.isArray(value) || value.length > LIMITS.seenBy) fail('invalid', 'Malformed request.');
	const asked = new Set(value.map(asId));
	if (asked.size === 0) return [];
	const players = db
		.select({ id: members.userId })
		.from(members)
		.where(and(eq(members.campaignId, actor.campaignId), eq(members.role, 'player')))
		.orderBy(members.joinedAt, sql`${members}.rowid`)
		.all()
		.map((member) => member.id);
	if ([...asked].some((id) => !players.includes(id))) {
		fail('not_found', 'That player is not in this campaign.');
	}
	return players.filter((id) => asked.has(id));
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
	(a ?? []).join() === (b ?? []).join();

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

/** How many feet a cell stands for. */
function asCellFeet(value: unknown): number {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < LIMITS.cellFeetMin ||
		value > LIMITS.cellFeetMax
	) {
		fail('invalid', `A cell stands for between ${LIMITS.cellFeetMin} and ${LIMITS.cellFeetMax} feet.`);
	}
	return value;
}

/** How many cells across a token is: also what a picture in the gallery can start one out as. */
export function asTokenSize(size: unknown): number {
	if (
		typeof size !== 'number' ||
		!Number.isInteger(size / TOKEN_SIZE_STEP) ||
		size < TOKEN_SIZE_STEP ||
		size > LIMITS.tokenSize
	) {
		fail(
			'invalid',
			`A token is between ${TOKEN_SIZE_STEP} and ${LIMITS.tokenSize} cells across, in steps of ${TOKEN_SIZE_STEP}.`
		);
	}
	return size;
}

/** A ring is in one of the token colours, or isn't there. */
export function asOutline(value: unknown): string | null {
	if (value !== null && !(TOKEN_COLORS as readonly unknown[]).includes(value)) {
		fail('invalid', 'Unknown outline colour.');
	}
	return value as string | null;
}

/** What a token is marked with: each mark once, in the order they are listed in. */
function asMarks(value: unknown): TokenMark[] {
	if (!Array.isArray(value) || value.some((mark) => !TOKEN_MARK_IDS.includes(mark))) {
		fail('invalid', 'Unknown mark.');
	}
	return TOKEN_MARK_IDS.filter((mark) => value.includes(mark)) as TokenMark[];
}

/** The number a token carries, or null for none. */
function asCount(value: unknown): number | null {
	if (value === null) return null;
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < LIMITS.countMin ||
		value > LIMITS.countMax
	) {
		fail('invalid', `A token's number is a whole one, from ${LIMITS.countMin} to ${LIMITS.countMax}.`);
	}
	return value;
}

/** Validates whichever token fields are present and drops everything else. */
function asTokenChanges(db: Db, actor: Actor, value: unknown): Partial<TokenInput> {
	const raw = asRecord(value);
	const out: Partial<TokenInput> = {};
	if (raw.name !== undefined) out.name = asText(raw.name, 'The name', LIMITS.tokenName, true);
	if (raw.color !== undefined) {
		if (!(TOKEN_COLORS as readonly unknown[]).includes(raw.color)) {
			fail('invalid', 'Unknown token colour.');
		}
		out.color = raw.color as string;
	}
	if (raw.outline !== undefined) out.outline = asOutline(raw.outline);
	if (raw.image !== undefined) out.image = raw.image === null ? null : asImageFile(raw.image);
	if (raw.x !== undefined) out.x = asCoord(raw.x);
	if (raw.y !== undefined) out.y = asCoord(raw.y);
	if (raw.size !== undefined) out.size = asTokenSize(raw.size);
	if (raw.marks !== undefined) out.marks = asMarks(raw.marks);
	if (raw.rotation !== undefined) {
		const turn = raw.rotation;
		if (typeof turn !== 'number' || !Number.isInteger(turn) || turn % ROTATION_STEP !== 0) {
			fail('invalid', `A token turns ${ROTATION_STEP} degrees at a time.`);
		}
		// A full turn is no turn: kept as 0 to 345.
		out.rotation = ((turn % 360) + 360) % 360;
	}
	if (raw.locked !== undefined) out.locked = asBool(raw.locked);
	if (raw.count !== undefined) out.count = asCount(raw.count);
	if (raw.hidden !== undefined) out.hidden = asBool(raw.hidden);
	if (raw.seenBy !== undefined) out.seenBy = asSeenBy(db, actor, raw.seenBy);
	return out;
}

/** Validates whichever marker fields are present and drops everything else. */
function asMarkerChanges(db: Db, actor: Actor, value: unknown): Partial<MarkerInput> {
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
	if (raw.seenBy !== undefined) out.seenBy = asSeenBy(db, actor, raw.seenBy);
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

	const input = asMarkerChanges(db, actor, raw);
	if (input.title === undefined) fail('invalid', "The title can't be empty.");
	if (input.x === undefined || input.y === undefined) fail('invalid', 'The marker needs a position.');
	// Hiding is a GM tool for world markers. Table notes are always shared.
	const hidden = kind === 'world' && input.hidden === true;

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
			hidden,
			// A secret is something hidden: what everyone sees is shared with nobody in particular.
			seenBy: hidden ? (input.seenBy ?? []) : [],
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

	const changes = asMarkerChanges(db, actor, rawChanges);
	if ((changes.hidden !== undefined || changes.seenBy !== undefined) && before.kind !== 'world') {
		fail('invalid', 'Only world markers can be hidden.');
	}

	const after: Marker = { ...before, ...changes };
	// Revealed to everyone, it is a secret with nobody.
	if (!after.hidden) after.seenBy = [];
	if (!MARKER_FIELDS.some((field) => markerDiffers(before, after, field))) return [];

	after.updatedAt = Date.now();
	db.update(markers)
		.set({
			type: after.type,
			title: after.title,
			description: after.description,
			x: after.x,
			y: after.y,
			hidden: after.hidden,
			seenBy: after.seenBy,
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
	// From when a world map could still be turned into a battle map: a
	// marker deleted before that has no map to come back to.
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

/**
 * Anyone who sees a token can take it off the map. Putting a deleted one
 * back is the GM's. `undoing` is the one way round that: a player who took
 * a token off the map may change their mind about it. Undo only ever
 * reaches a player's own changes, so that is all it opens.
 */
function requireTokenRestore(actor: Actor, undoing: boolean) {
	if (!canRestoreToken(actor.role) && !undoing) {
		fail('forbidden', 'Only the GM can restore a token.');
	}
}

function createToken(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	const map = findMap(db, actor, asId(raw.mapId));
	if (map.kind !== 'battle') fail('invalid', 'Tokens go on battle maps.');

	const input = asTokenChanges(db, actor, raw);
	if (input.name === undefined) fail('invalid', "The name can't be empty.");
	// Only the GM has anything to hide.
	const hidden = actor.role === 'gm' && input.hidden === true;
	if (input.x === undefined || input.y === undefined) fail('invalid', 'The token needs a position.');
	requireInSight(actor, map.fog, input.x, input.y);

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
			outline: input.outline ?? null,
			image,
			x: input.x,
			y: input.y,
			size: input.size ?? 1,
			rotation: input.rotation ?? 0,
			locked: input.locked === true,
			marks: input.marks ?? [],
			count: input.count ?? null,
			hidden,
			seenBy: hidden ? (input.seenBy ?? []) : [],
			createdAt: now,
			updatedAt: now
		})
		.run();
	return [record(db, actor, map.id, 'token', 'create', null, readToken(db, id))];
}

/**
 * Puts a copy of a token beside it: the same in everything but where it
 * stands, and never locked, so it can be dragged to its place. Anyone who
 * sees a token can copy it.
 */
function duplicateToken(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { token, deletedAt } = findToken(db, actor, id);
	if (deletedAt !== null) fail('conflict', 'That token was deleted.');
	const map = readMap(db, token.mapId);
	if (map.kind !== 'battle') fail('invalid', 'Tokens go on battle maps.');

	// Its own width to the right, or as many more as it takes to find room.
	// Where the map ends that way, to the left instead.
	const step = (token.size * map.grid.size) / map.width;
	const taken = db
		.select({ x: tokens.x, y: tokens.y })
		.from(tokens)
		.where(and(eq(tokens.mapId, token.mapId), isNull(tokens.deletedAt)))
		.all();
	const free = (x: number) =>
		x >= 0 &&
		x <= 1 &&
		!taken.some((t) => Math.abs(t.x - x) < step / 2 && Math.abs(t.y - token.y) < step / 2);
	const spots = [1, 2, 3, 4, 5, 6].flatMap((n) => [token.x + n * step, token.x - n * step]);
	const fallback = token.x + step <= 1 ? token.x + step : Math.max(0, token.x - step);
	const x =
		spots.filter((x) => x > token.x).find(free) ?? spots.find(free) ?? fallback;
	requireInSight(actor, map.fog, x, token.y);
	const copy = newId();
	const now = Date.now();
	db.insert(tokens)
		.values({
			id: copy,
			mapId: token.mapId,
			name: token.name,
			color: token.color,
			outline: token.outline,
			image: token.image,
			x,
			y: token.y,
			size: token.size,
			rotation: token.rotation,
			locked: false,
			marks: token.marks,
			count: token.count,
			hidden: token.hidden,
			seenBy: token.seenBy,
			createdAt: now,
			updatedAt: now
		})
		.run();
	return [record(db, actor, token.mapId, 'token', 'create', null, readToken(db, copy))];
}

const TOKEN_FIELDS = [
	'name',
	'color',
	'outline',
	'image',
	'x',
	'y',
	'size',
	'rotation',
	'locked',
	'marks',
	'count',
	'hidden',
	'seenBy'
] as const;
/** What a lock holds in place. */
const TOKEN_PLACING = ['x', 'y', 'size', 'rotation'] as const;

/**
 * Whether a field of a token is not what it was. Its marks are a list, and
 * so are the players it is a secret with: they are compared by what is in
 * them. A token from before there were marks has none, which is the same as
 * an empty list, and one from before tokens carried a number has no number.
 */
function tokenDiffers(before: Token, after: Token, field: (typeof TOKEN_FIELDS)[number]): boolean {
	if (field === 'marks' || field === 'seenBy') return !sameList(before[field], after[field]);
	if (field === 'count') return (before.count ?? null) !== (after.count ?? null);
	return before[field] !== after[field];
}

/** `restoring` says this is undo, putting back what an earlier change took away. */
function updateToken(
	db: Db,
	actor: Actor,
	id: string,
	rawChanges: unknown,
	restoring = false
): StoredEvent[] {
	const { token: before, deletedAt } = findToken(db, actor, id);
	if (deletedAt !== null) fail('conflict', 'That token was deleted. Restore it first.');

	const changes = asTokenChanges(db, actor, rawChanges);
	// Hiding is the GM's, and so is saying who a hidden token is a secret
	// with. Everything else about a token is the whole table's.
	if (!canHideToken(actor.role) && (changes.hidden !== undefined || changes.seenBy !== undefined)) {
		fail('forbidden', 'Only the GM can hide a token.');
	}

	const after: Token = { ...before, ...changes };
	// Revealed to everyone, it is a secret with nobody.
	if (!after.hidden) after.seenBy = [];
	if (!TOKEN_FIELDS.some((field) => tokenDiffers(before, after, field))) return [];
	// A lock holds until it is taken off. The same change can do both.
	if (before.locked && after.locked && TOKEN_PLACING.some((f) => before[f] !== after[f])) {
		fail('conflict', 'That token is locked. Unlock it first.');
	}
	if (before.x !== after.x || before.y !== after.y) {
		requireInSight(actor, readMap(db, before.mapId).fog, after.x, after.y);
	}
	if (after.image && after.image !== before.image) {
		// Undo may hand a player's token back a picture the GM gave it and
		// has not revealed: it is the token's own past, not a pick.
		findPicture(db, actor, after.image, 'token', restoring);
	}

	after.updatedAt = Date.now();
	db.update(tokens)
		.set({
			name: after.name,
			color: after.color,
			outline: after.outline,
			image: after.image,
			x: after.x,
			y: after.y,
			size: after.size,
			rotation: after.rotation,
			locked: after.locked,
			marks: after.marks,
			count: after.count,
			hidden: after.hidden,
			seenBy: after.seenBy,
			updatedAt: after.updatedAt
		})
		.where(eq(tokens.id, id))
		.run();
	return [record(db, actor, before.mapId, 'token', 'update', before, after)];
}

function deleteToken(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { token, deletedAt } = findToken(db, actor, id);
	if (deletedAt !== null) fail('conflict', 'That token is already deleted.');

	db.update(tokens).set({ deletedAt: Date.now() }).where(eq(tokens.id, id)).run();
	return [record(db, actor, token.mapId, 'token', 'delete', token, null)];
}

function restoreToken(db: Db, actor: Actor, id: string, undoing = false): StoredEvent[] {
	const { token, deletedAt } = findToken(db, actor, id);
	requireTokenRestore(actor, undoing);
	if (deletedAt === null) fail('conflict', 'That token is already on the map.');

	db.update(tokens).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(tokens.id, id)).run();
	return [record(db, actor, token.mapId, 'token', 'restore', null, readToken(db, id))];
}

// ---------------------------------------------------------------- drawings

function readDrawing(db: Db, id: string): Drawing {
	return db.select(drawingColumns).from(drawings).where(eq(drawings.id, id)).get()!;
}

function requireDrawingChange(actor: Actor, drawing: Drawing, what: string) {
	if (!canChangeDrawing(actor.role, actor.userId, drawing)) {
		fail('forbidden', `Only ${drawing.authorName} or the GM can ${what} this drawing.`);
	}
}

/** Five decimal places put a point within a hundredth of a pixel on any map. */
const rounded = (n: number) => Math.round(n * 1e5) / 1e5;

function asDrawingPoints(value: unknown, kind: DrawingKind): Point[] {
	if (!Array.isArray(value) || value.length > LIMITS.drawingPoints) {
		fail('invalid', 'That drawing could not be kept.');
	}
	const template = isTemplate(kind);
	if (kind === 'text' ? value.length !== 1 : template ? value.length !== 2 : value.length < 2) {
		fail('invalid', 'That drawing could not be kept.');
	}
	const points = value.map((p) => {
		if (!Array.isArray(p) || p.length !== 2) fail('invalid', 'That drawing could not be kept.');
		return [rounded(asCoord(p[0])), rounded(asCoord(p[1]))] as Point;
	});
	// A template with both its points on one spot covers nothing.
	if (template && points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
		fail('invalid', 'That template has no size.');
	}
	return points;
}

function asDrawingKind(value: unknown): DrawingKind {
	if (value === 'line' || value === 'text') return value;
	if (typeof value === 'string' && isTemplate(value)) return value;
	fail('invalid', 'Unknown kind of drawing.');
}

function asInk(value: unknown): string {
	if (!(INK_COLORS as readonly unknown[]).includes(value)) fail('invalid', 'Unknown colour.');
	return value as string;
}

function asDrawingText(value: unknown): string {
	return asText(value, 'The text', LIMITS.drawingText, true);
}

/** `points` moved as far as `by` says, or as far as the map goes that way. */
function slid(points: Point[], by: unknown): Point[] {
	if (!Array.isArray(by) || by.length !== 2) fail('invalid', 'Malformed request.');
	const along = (axis: 0 | 1): number => {
		const d = by[axis];
		if (typeof d !== 'number' || !Number.isFinite(d)) fail('invalid', 'Malformed request.');
		const at = points.map((p) => p[axis]);
		return Math.min(1 - Math.max(...at), Math.max(-Math.min(...at), d));
	};
	const [dx, dy] = [along(0), along(1)];
	return points.map(([x, y]) => [rounded(x + dx), rounded(y + dy)]);
}

function createDrawing(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	const map = findMap(db, actor, asId(raw.mapId));
	if (map.kind !== 'battle') fail('invalid', 'Drawings go on battle maps.');
	const kind = asDrawingKind(raw.kind);

	const points = asDrawingPoints(raw.points, kind);
	const size = raw.size ?? DRAWING_SIZE[kind];
	if (
		typeof size !== 'number' ||
		!(size >= LIMITS.drawingSizeMin && size <= LIMITS.drawingSizeMax)
	) {
		fail('invalid', 'That drawing could not be kept.');
	}
	const held = db
		.select({ n: count() })
		.from(drawings)
		.where(and(eq(drawings.mapId, map.id), isNull(drawings.deletedAt)))
		.get();
	if ((held?.n ?? 0) >= LIMITS.drawings) {
		fail('conflict', 'This map is full of drawings. Rub some out first.');
	}

	const id = newId();
	const now = Date.now();
	db.insert(drawings)
		.values({
			id,
			mapId: map.id,
			kind,
			points,
			text: kind === 'text' ? asDrawingText(raw.text) : '',
			color: raw.color === undefined ? INK_COLORS[0] : asInk(raw.color),
			size,
			authorId: actor.userId,
			authorName: actor.name,
			createdAt: now,
			updatedAt: now
		})
		.run();
	return [record(db, actor, map.id, 'drawing', 'create', null, readDrawing(db, id))];
}

function writeDrawing(db: Db, actor: Actor, before: Drawing, after: Drawing): StoredEvent[] {
	if (
		before.text === after.text &&
		before.color === after.color &&
		samePoints(before.points, after.points)
	) {
		return [];
	}
	after.updatedAt = Date.now();
	db.update(drawings)
		.set({ points: after.points, text: after.text, color: after.color, updatedAt: after.updatedAt })
		.where(eq(drawings.id, after.id))
		.run();
	return [record(db, actor, before.mapId, 'drawing', 'update', before, after)];
}

/** The drawing as it is, deleted ones refused, for whoever may change it. */
function drawingToChange(db: Db, actor: Actor, id: string): Drawing {
	const { drawing, deletedAt } = findDrawing(db, actor, id);
	requireDrawingChange(actor, drawing, 'change');
	if (deletedAt !== null) fail('conflict', 'That drawing was rubbed out. Restore it first.');
	return drawing;
}

/** Rewords a text, recolours a drawing, slides it across the map: whichever are asked for. */
function updateDrawing(db: Db, actor: Actor, id: string, rawChanges: unknown): StoredEvent[] {
	const before = drawingToChange(db, actor, id);
	const changes = asRecord(rawChanges);
	const after: Drawing = { ...before };
	if (changes.text !== undefined) {
		if (before.kind !== 'text') fail('invalid', 'Only a text has words to change.');
		after.text = asDrawingText(changes.text);
	}
	if (changes.color !== undefined) after.color = asInk(changes.color);
	if (changes.move !== undefined) after.points = slid(before.points, changes.move);
	return writeDrawing(db, actor, before, after);
}

function deleteDrawing(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { drawing, deletedAt } = findDrawing(db, actor, id);
	requireDrawingChange(actor, drawing, 'rub out');
	if (deletedAt !== null) fail('conflict', 'That drawing is already rubbed out.');

	db.update(drawings).set({ deletedAt: Date.now() }).where(eq(drawings.id, id)).run();
	return [record(db, actor, drawing.mapId, 'drawing', 'delete', drawing, null)];
}

function restoreDrawing(db: Db, actor: Actor, id: string): StoredEvent[] {
	const { drawing, deletedAt } = findDrawing(db, actor, id);
	requireDrawingChange(actor, drawing, 'restore');
	if (deletedAt === null) fail('conflict', 'That drawing is already on the map.');

	db.update(drawings)
		.set({ deletedAt: null, updatedAt: Date.now() })
		.where(eq(drawings.id, id))
		.run();
	return [record(db, actor, drawing.mapId, 'drawing', 'restore', null, readDrawing(db, id))];
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
	const closed = raw.closed !== undefined && asBool(raw.closed);
	const kind = raw.kind === undefined ? 'world' : asMapKind(raw.kind);

	// Each region is a doorway to a map of its own, created along with it.
	const targetId = insertMap(db, actor.campaignId, map.id, name, kind);
	const id = newId();
	db.insert(regions)
		.values({
			id,
			mapId: map.id,
			targetMapId: targetId,
			points,
			hidden,
			closed,
			createdAt: Date.now()
		})
		.run();

	return [
		record(db, actor, targetId, 'map', 'create', null, readMap(db, targetId)),
		record(db, actor, map.id, 'region', 'create', null, readRegion(db, id))
	];
}

const samePoints = (a: Point[], b: Point[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Reshapes a region, hides it or reveals it, says which players a hidden
 * one is there for, closes it to players or opens it: whichever are asked
 * for. Its name is the name of its map, changed with `map.update`.
 */
function updateRegion(
	db: Db,
	actor: Actor,
	id: string,
	changes: { points?: unknown; hidden?: unknown; seenBy?: unknown; closed?: unknown }
): StoredEvent[] {
	requireWorldEdit(actor);
	const before = findRegion(db, actor, id);

	const after: Region = { ...before };
	if (changes.points !== undefined) after.points = asPoints(changes.points);
	if (changes.hidden !== undefined) after.hidden = asBool(changes.hidden);
	if (changes.seenBy !== undefined) after.seenBy = asSeenBy(db, actor, changes.seenBy);
	if (changes.closed !== undefined) after.closed = asBool(changes.closed);
	// Revealed to everyone, it is a secret with nobody.
	if (!after.hidden) after.seenBy = [];
	if (
		samePoints(before.points, after.points) &&
		before.hidden === after.hidden &&
		sameList(before.seenBy, after.seenBy) &&
		before.closed === after.closed
	) {
		return [];
	}
	// The party is where the players are, so never somewhere they are kept out of.
	const shutting = (after.hidden && !before.hidden) || (after.closed && !before.closed);
	if (shutting && readParty(db, actor.campaignId)?.trail.includes(before.targetMapId)) {
		fail(
			'conflict',
			`The party is in there. Move it out before ${after.closed && !before.closed ? 'closing' : 'hiding'} the region.`
		);
	}

	db.update(regions)
		.set({
			points: after.points,
			hidden: after.hidden,
			seenBy: after.seenBy,
			closed: after.closed
		})
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
	// The party goes with the map it stands on, like everything else there.
	const party = readParty(db, actor.campaignId);
	const lost = party && ids.includes(party.mapId) ? party : null;

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
		...doomed.map((map) => record(db, actor, map.id, 'map', 'delete', map, null)),
		...(lost ? [record(db, actor, region.mapId, 'party', 'delete', lost, null)] : [])
	];
}

/** True while nothing has been put on a map: no image, no markers, no tokens, no drawings, no regions, no party. */
function isBlank(db: Db, mapId: string): boolean {
	if (db.select({ id: parties.mapId }).from(parties).where(eq(parties.mapId, mapId)).get()) {
		return false;
	}
	const marker = db.select({ id: markers.id }).from(markers).where(eq(markers.mapId, mapId)).get();
	const token = db.select({ id: tokens.id }).from(tokens).where(eq(tokens.mapId, mapId)).get();
	const drawing = db
		.select({ id: drawings.id })
		.from(drawings)
		.where(eq(drawings.mapId, mapId))
		.get();
	const region = db.select({ id: regions.id }).from(regions).where(eq(regions.mapId, mapId)).get();
	return !readMap(db, mapId).imageFile && !marker && !token && !drawing && !region;
}

const sameGrid = (a: Grid, b: Grid) =>
	a.size === b.size && a.x === b.x && a.y === b.y && a.shown === b.shown;

const sameFog = (a: Fog, b: Fog) => JSON.stringify(a) === JSON.stringify(b);

const sameTurns = (a: Turns, b: Turns) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The turn order with whichever of its settings are present changed, and
 * checked. Every token in it is one of this map's. One that has been taken
 * off the map may stay: it keeps its place for when it comes back.
 */
function asTurns(db: Db, mapId: string, value: unknown, current: Turns): Turns {
	const raw = asRecord(value);
	let order = current.order;
	if (raw.order !== undefined) {
		if (!Array.isArray(raw.order) || raw.order.length > LIMITS.turns) {
			fail('invalid', `At most ${LIMITS.turns} tokens take turns on one map.`);
		}
		order = [...new Set(raw.order.map(asId))];
		const here = db.select({ id: tokens.id }).from(tokens).where(eq(tokens.mapId, mapId)).all();
		const known = new Set(here.map((token) => token.id));
		if (order.some((id) => !known.has(id))) fail('not_found', 'That token does not exist.');
	}
	let whose = current.current;
	if (raw.current !== undefined) whose = raw.current === null ? null : asId(raw.current);
	// The turn of a token that left the order is nobody's.
	if (whose !== null && !order.includes(whose)) whose = null;
	const round = raw.round === undefined ? current.round : raw.round;
	if (typeof round !== 'number' || !Number.isInteger(round) || round < 1 || round > 9999) {
		fail('invalid', 'Malformed turn order.');
	}
	// What each token rolled for its place, for as long as it has one. They
	// are kept in the order the tokens take their turns in, so that the same
	// rolls always read the same.
	const given = raw.rolls === undefined ? (current.rolls ?? {}) : asRecord(raw.rolls);
	const rolls: Record<string, number> = {};
	for (const id of order) {
		const roll = given[id];
		if (roll === undefined || roll === null) continue;
		if (
			typeof roll !== 'number' ||
			!Number.isInteger(roll) ||
			roll < LIMITS.rollMin ||
			roll > LIMITS.rollMax
		) {
			fail('invalid', `A roll is a whole number, from ${LIMITS.rollMin} to ${LIMITS.rollMax}.`);
		}
		rolls[id] = roll;
	}
	const turns: Turns = { order, current: whose, round };
	if (Object.keys(rolls).length) turns.rolls = rolls;
	return turns;
}

/**
 * Ends the turn of the token named, and moves on to the next. The GM runs
 * the fight, but ending a turn is the table's: anyone can, for a token they
 * can see. Starting the fight, and moving on from a turn that is nobody's
 * to the players, stay with the GM.
 */
function passTurn(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	const map = findMap(db, actor, asId(raw.mapId));
	if (map.kind !== 'battle') fail('invalid', 'Turns are taken on battle maps.');
	const from = raw.from === null ? null : asId(raw.from);
	// Someone else has moved the fight on already: that turn is over.
	if (map.turns.current !== from) return [];

	const here = db
		.select(tokenColumns)
		.from(tokens)
		.where(and(eq(tokens.mapId, map.id), isNull(tokens.deletedAt)))
		.all();
	if (actor.role !== 'gm') {
		const whose = here.find((token) => token.id === from);
		if (!whose || !canSeeToken(viewerOf(actor), whose, map.fog)) {
			fail('forbidden', 'Only the GM can move on from this turn.');
		}
	}
	const next = nextTurn(map.turns, here.map((token) => token.id));
	if (!next) return [];
	return writeMap(db, actor, map, { ...map, turns: { ...map.turns, ...next } });
}

/** How many miles across a world map is, or null for no scale of its own. */
function asMiles(value: unknown): number | null {
	if (value === null) return null;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < LIMITS.milesMin ||
		value > LIMITS.milesMax
	) {
		fail('invalid', `A map is between ${LIMITS.milesMin} and ${LIMITS.milesMax} miles across.`);
	}
	return value;
}

/** Fog with whichever of its settings are present changed, and checked. */
function asFog(value: unknown, current: Fog): Fog {
	const raw = asRecord(value);
	const on = raw.on === undefined ? current.on : asBool(raw.on);
	// Six decimal places put an edge within a thirtieth of a pixel on any map.
	const fine = (n: number) => Math.round(n * 1e6) / 1e6;
	let clear = current.clear;
	if (raw.clear !== undefined) {
		if (!Array.isArray(raw.clear)) fail('invalid', 'Malformed fog.');
		if (raw.clear.length > LIMITS.fogRects) {
			fail('conflict', 'The fog is in too many pieces. Cover the whole map and start again.');
		}
		clear = raw.clear.map((box): Rect => {
			if (!Array.isArray(box) || box.length !== 4) fail('invalid', 'Malformed fog.');
			const [x0, y0, x1, y1] = box.map((n) => fine(asCoord(n)));
			if (x0 >= x1 || y0 >= y1) fail('invalid', 'Malformed fog.');
			return [x0, y0, x1, y1];
		});
	}
	let spots = current.spots ?? [];
	if (raw.spots !== undefined) {
		if (!Array.isArray(raw.spots) || raw.spots.length > LIMITS.fogSpots) {
			fail('invalid', 'Malformed fog.');
		}
		spots = raw.spots.map((spot): Oval => {
			if (!Array.isArray(spot) || spot.length !== 4) fail('invalid', 'Malformed fog.');
			const [rx, ry] = [spot[2], spot[3]];
			const reach = (n: unknown): n is number => typeof n === 'number' && n > 0 && n <= 4;
			if (!reach(rx) || !reach(ry)) fail('invalid', 'Malformed fog.');
			return [fine(asCoord(spot[0])), fine(asCoord(spot[1])), fine(rx), fine(ry)];
		});
	}
	// Kept without the patches where there are none, as fog always was.
	return spots.length ? { on, clear, spots } : { on, clear };
}

/**
 * Where the party is as far as one map is concerned: the spot it stands on,
 * if it is on this map, or the middle of the region it is somewhere inside
 * of. Null when it is elsewhere, or nowhere.
 */
function partySpotOn(db: Db, party: Party | null, mapId: string): Point | null {
	if (!party) return null;
	if (party.mapId === mapId) return [party.x, party.y];
	const at = party.trail.indexOf(mapId);
	if (at === -1) return null;
	const door = db
		.select({ points: regions.points })
		.from(regions)
		.where(and(eq(regions.mapId, mapId), eq(regions.targetMapId, party.trail[at + 1])))
		.get();
	return door ? middleOf(door.points) : null;
}

/**
 * The fog of a world map with what the party can see from where it is
 * cleared of it. A map the party isn't on or inside of keeps its fog as it
 * is, and so does a battle map: its fog is cleared by hand.
 */
function inPartySight(db: Db, campaignId: string, map: MapInfo, fog: Fog): Fog {
	if (map.kind !== 'world' || !fog.on) return fog;
	const spot = partySpotOn(db, readParty(db, campaignId), map.id);
	if (!spot) return fog;
	return (
		sighted(fog, map, spot) ??
		fail('conflict', 'The fog of this map is in too many patches. Turn it off and on again.')
	);
}

function writeMap(db: Db, actor: Actor, before: MapInfo, after: MapInfo): StoredEvent[] {
	if (
		before.name === after.name &&
		sameGrid(before.grid, after.grid) &&
		before.cellFeet === after.cellFeet &&
		sameFog(before.fog, after.fog) &&
		sameTurns(before.turns, after.turns) &&
		before.miles === after.miles &&
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
	// A map's kind is not among these: it is what it was made as.
	db.update(maps)
		.set({
			name: after.name,
			grid: after.grid,
			cellFeet: after.cellFeet,
			fog: after.fog,
			turns: after.turns,
			miles: after.miles,
			imageFile: after.imageFile,
			width: after.width,
			height: after.height
		})
		.where(eq(maps.id, after.id))
		.run();
	return [record(db, actor, after.id, 'map', 'update', before, after)];
}

/**
 * Renames a map, sets up its grid, says how many feet a cell stands for,
 * lays an image from the gallery under it, covers it with fog or clears
 * some, says whose turn it is, or how many miles across it is: whichever
 * are asked for. What kind of map it is was settled when its region was
 * drawn, and stays so.
 */
function updateMap(
	db: Db,
	actor: Actor,
	id: string,
	changes: {
		name?: unknown;
		kind?: unknown;
		grid?: unknown;
		cellFeet?: unknown;
		image?: unknown;
		fog?: unknown;
		turns?: unknown;
		miles?: unknown;
	}
): StoredEvent[] {
	requireWorldEdit(actor);
	const before = findMap(db, actor, id);
	const { name, kind, grid, cellFeet, image, fog, turns, miles } = changes;
	if (kind !== undefined) {
		fail('invalid', 'A map stays the kind it was made as. Draw a region for the other kind.');
	}
	if ([name, grid, cellFeet, image, fog, turns, miles].every((change) => change === undefined)) {
		fail('invalid', 'Malformed request.');
	}

	const after: MapInfo = { ...before };
	if (changes.name !== undefined) after.name = asText(changes.name, 'The name', LIMITS.name, true);
	if (changes.grid !== undefined) after.grid = asGrid(changes.grid, before.grid);
	if (cellFeet !== undefined) after.cellFeet = asCellFeet(cellFeet);
	if (fog !== undefined) {
		after.fog = asFog(fog, before.fog);
		// On a world map the fog is the party's to lift: wherever it is when
		// the fog comes down, it can see around itself.
		if (after.fog.on && !before.fog.on) {
			after.fog = inPartySight(db, actor.campaignId, before, after.fog);
		}
	}
	if (turns !== undefined) {
		if (before.kind !== 'battle') fail('invalid', 'Turns are taken on battle maps.');
		after.turns = asTurns(db, before.id, turns, before.turns);
	}
	if (miles !== undefined) {
		if (before.kind !== 'world') fail('invalid', 'A battle map is measured in feet.');
		after.miles = asMiles(miles);
	}
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

// ------------------------------------------------------------------- party

/** The maps on the way to one, by id: the first map of the campaign first, its own last. */
function trailOf(db: Db, mapId: string): string[] {
	const trail: string[] = [];
	for (let id: string | null = mapId, depth = 0; id && depth < 64; depth++) {
		trail.unshift(id);
		id = db.select({ parentId: maps.parentId }).from(maps).where(eq(maps.id, id)).get()?.parentId ?? null;
	}
	return trail;
}

/** Where a campaign's party is, or null while it is nowhere. */
export function readParty(db: Db, campaignId: string): Party | null {
	const row = db.select().from(parties).where(eq(parties.campaignId, campaignId)).get();
	if (!row) return null;
	return { id: campaignId, mapId: row.mapId, x: row.x, y: row.y, trail: trailOf(db, row.mapId) };
}

/**
 * Puts the party at `to`, or with null takes it off the maps altogether.
 * With `along`, it travels to a spot of the map it is on: what it passes on
 * the way comes out of the fog too.
 */
function writeParty(
	db: Db,
	actor: Actor,
	to: { mapId: string; x: number; y: number } | null,
	along = false
): StoredEvent[] {
	const before = readParty(db, actor.campaignId);
	if (!to) {
		if (!before) return [];
		db.delete(parties).where(eq(parties.campaignId, actor.campaignId)).run();
		return [record(db, actor, before.mapId, 'party', 'delete', before, null)];
	}
	if (before && before.mapId === to.mapId && before.x === to.x && before.y === to.y) return [];

	const row = { ...to, updatedAt: Date.now() };
	db.insert(parties)
		.values({ campaignId: actor.campaignId, ...row })
		.onConflictDoUpdate({ target: parties.campaignId, set: row })
		.run();
	const after = readParty(db, actor.campaignId)!;
	const made = [record(db, actor, to.mapId, 'party', before ? 'update' : 'create', before, after)];
	// Where the party goes, the fog of a world map lifts: around the spot it
	// stands on, and on every map further out, around the region it is in.
	for (const mapId of after.trail) {
		const map = readMap(db, mapId);
		let fog = map.fog;
		if (along && before?.mapId === mapId && mapId === to.mapId && map.kind === 'world') {
			for (const stop of stopsBetween(map, [before.x, before.y], [to.x, to.y])) {
				fog = sighted(fog, map, stop) ?? fog;
			}
		}
		fog = inPartySight(db, actor.campaignId, map, fog);
		if (fog !== map.fog) made.push(...writeMap(db, actor, map, { ...map, fog }));
	}
	return made;
}

/**
 * Moves the party to a spot of a world map: the one it is on, or any other.
 * It stands where the players are, so never on a map they are kept out of.
 */
function moveParty(db: Db, actor: Actor, raw: Record<string, unknown>): StoredEvent[] {
	if (!canMoveParty(actor.role)) fail('forbidden', 'Only the GM moves the party.');
	const map = findMap(db, actor, asId(raw.mapId));
	if (map.kind === 'battle') {
		fail('invalid', 'The party goes on world maps. On a battle map, tokens stand for it.');
	}
	// Fog is no bar: the party lifts it by going there.
	if (isShut(db, map.id)) {
		fail(
			'conflict',
			"Players can't go there yet. Reveal the region that leads there to all of them, and open it, first."
		);
	}
	const along = raw.along !== undefined && asBool(raw.along);
	return writeParty(db, actor, { mapId: map.id, x: asCoord(raw.x), y: asCoord(raw.y) }, along);
}

/** Takes the party off the maps: it is nowhere until it is put on one again. */
function removeParty(db: Db, actor: Actor): StoredEvent[] {
	if (!canMoveParty(actor.role)) fail('forbidden', 'Only the GM moves the party.');
	return writeParty(db, actor, null);
}

// ------------------------------------------------------------------ revert

const MARKER_FIELDS = ['type', 'title', 'description', 'x', 'y', 'hidden', 'seenBy'] as const;

/** Whether a field of a marker is not what it was. The players it is a secret with are a list. */
function markerDiffers(before: Marker, after: Marker, field: (typeof MARKER_FIELDS)[number]): boolean {
	if (field === 'seenBy') return !sameList(before.seenBy, after.seenBy);
	return before[field] !== after[field];
}

/**
 * The changes among these that `revert` can take back, as sequence numbers.
 * Creating a map has no opposite of its own, and deleting a region, with
 * the maps behind it, is for good.
 */
export function undoable(made: StoredEvent[]): number[] {
	const gone = deletedMaps(made);
	const final = (e: StoredEvent) =>
		(e.entity === 'map' && e.action !== 'update') ||
		(e.entity === 'region' && e.action === 'delete') ||
		// A party that went with the map it stood on has no map to come back to.
		(e.entity === 'party' && e.action === 'delete' && gone.includes((e.before as Party).mapId));
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
			if (!markerDiffers(before, after, field)) continue;
			changes[field] = field === 'seenBy' ? (before.seenBy ?? []) : before[field];
		}
		return updateMarker(db, actor, id, changes);
	}

	if (event.entity === 'drawing') {
		if (event.action === 'create' || event.action === 'restore') return deleteDrawing(db, actor, id);
		if (event.action === 'delete') return restoreDrawing(db, actor, id);
		// As everywhere: only what this change changed goes back.
		const before = event.before as Drawing;
		const after = event.after as Drawing;
		const current = drawingToChange(db, actor, id);
		return writeDrawing(db, actor, current, {
			...current,
			text: before.text === after.text ? current.text : before.text,
			color: before.color === after.color ? current.color : before.color,
			points: samePoints(before.points, after.points) ? current.points : before.points
		});
	}

	if (event.entity === 'token') {
		if (event.action === 'create' || event.action === 'restore') return deleteToken(db, actor, id);
		if (event.action === 'delete') return restoreToken(db, actor, id, true);
		// Undoing a move puts the token back where it stood, and leaves a
		// rename made since alone.
		const before = event.before as Token;
		const after = event.after as Token;
		const changes: Record<string, unknown> = {};
		for (const field of TOKEN_FIELDS) {
			if (!tokenDiffers(before, after, field)) continue;
			if (field === 'marks' || field === 'seenBy') changes[field] = before[field] ?? [];
			else if (field === 'count') changes.count = before.count ?? null;
			else changes[field] = before[field];
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
		// from before regions could be hidden, shared or closed have none of
		// that to compare.
		const before = event.before as Region;
		const after = event.after as Region;
		const hid = Boolean(before.hidden) !== Boolean(after.hidden);
		const shut = Boolean(before.closed) !== Boolean(after.closed);
		return updateRegion(db, actor, id, {
			points: samePoints(before.points, after.points) ? undefined : before.points,
			hidden: hid ? Boolean(before.hidden) : undefined,
			seenBy: sameList(before.seenBy, after.seenBy) ? undefined : (before.seenBy ?? []),
			closed: shut ? Boolean(before.closed) : undefined
		});
	}

	if (event.entity === 'party') {
		// Back to where it stood before, or off the map if it stood nowhere.
		// Going back is a move like any other: the map still has to be there,
		// and open to the players.
		const before = event.before as Party | null;
		if (!before) return writeParty(db, actor, null);
		return moveParty(db, actor, { mapId: before.mapId, x: before.x, y: before.y });
	}

	if (event.action === 'delete') fail('invalid', "A deleted map can't be brought back.");
	if (event.action !== 'update') {
		fail('invalid', "A map can't be un-created. Delete the region that leads to it instead.");
	}
	requireWorldEdit(actor);
	const old = event.before as MapInfo;
	const made = event.after as MapInfo;
	const current = findMap(db, actor, id);
	// The fog goes back only if this change was to the fog: it is changed
	// often, between other things, and those should not take it along.
	const fogged = old.fog && made.fog && !sameFog(old.fog, made.fog);
	// The same goes for whose turn it is, and for the scale of a world map.
	const turned = old.turns && made.turns && !sameTurns(old.turns, made.turns);
	const scaled = old.miles !== undefined && old.miles !== made.miles;
	return writeMap(db, actor, current, {
		...current,
		turns: turned ? old.turns : current.turns,
		miles: scaled ? old.miles : current.miles,
		name: old.name,
		// Changes from before there were battle maps have no grid, and ones
		// from before distances were told in feet have no scale. The kind of
		// the map is left alone, whatever an old change did to it.
		grid: old.grid ?? current.grid,
		cellFeet: old.cellFeet ?? current.cellFeet,
		fog: fogged ? old.fog : current.fog,
		imageFile: old.imageFile,
		width: old.width,
		height: old.height
	});
}

// ----------------------------------------------------------------- perform

function run(db: Db, actor: Actor, input: unknown, nested = false): StoredEvent[] {
	const cmd = asRecord(input);
	switch (cmd.t) {
		case 'batch': {
			const { cmds } = cmd;
			if (nested || !Array.isArray(cmds) || cmds.length === 0 || cmds.length > LIMITS.batch) {
				fail('invalid', 'Malformed request.');
			}
			// One refusal throws, and the transaction they all share takes
			// the rest back with it.
			return cmds.flatMap((each) => run(db, actor, each, true));
		}
		case 'token.duplicate':
			return duplicateToken(db, actor, asId(cmd.id));
		case 'drawing.create':
			return createDrawing(db, actor, cmd);
		case 'drawing.update':
			return updateDrawing(db, actor, asId(cmd.id), cmd.changes);
		case 'drawing.delete':
			return deleteDrawing(db, actor, asId(cmd.id));
		case 'drawing.restore':
			return restoreDrawing(db, actor, asId(cmd.id));
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
		case 'party.move':
			return moveParty(db, actor, cmd);
		case 'party.remove':
			return removeParty(db, actor);
		case 'turn.next':
			return passTurn(db, actor, cmd);
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
