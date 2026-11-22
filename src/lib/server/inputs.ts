// What a command is checked with before anything is done about it: who is
// asking, the refusal they are sent, and one function for each kind of value
// a command can carry. Each takes whatever arrived over the network, and
// hands back a value of the right kind or refuses.
//
// `server/world.ts` does the work with what these let through.

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { members } from './schema';
import { wrapOffset } from '../shared/grid';
import {
	LIMITS,
	MARKER_TYPE_IDS,
	ROTATION_STEP,
	TOKEN_COLORS,
	TOKEN_MARK_IDS,
	TOKEN_SIZE_STEP,
	type Grid,
	type MapKind,
	type MarkerInput,
	type MarkerType,
	type Point,
	type Role,
	type TokenInput,
	type TokenMark,
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

export function fail(code: ErrorCode, message: string): never {
	throw new ActionError(code, message);
}

/** Naming rule for the files pictures are kept in: `<random>-<random>.<ext>`. */
export const IMAGE_FILE_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9]+\.(png|jpg|gif|webp|avif)$/;

export function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail('invalid', 'Malformed request.');
	}
	return value as Record<string, unknown>;
}

export function asId(value: unknown): string {
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

export function asCoord(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		fail('invalid', 'That position is outside the map.');
	}
	return value;
}

export function asPoints(value: unknown): Point[] {
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

export function asMarkerType(value: unknown): MarkerType {
	if (typeof value !== 'string' || !MARKER_TYPE_IDS.includes(value)) {
		fail('invalid', 'Unknown marker type.');
	}
	return value as MarkerType;
}

export function asBool(value: unknown): boolean {
	if (typeof value !== 'boolean') fail('invalid', 'Malformed request.');
	return value;
}

/**
 * The players a hidden thing is a secret with, by user id: each of them
 * once, and each a player of this campaign.
 */
export function asSeenBy(db: Db, actor: Actor, value: unknown): string[] {
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

export const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
	(a ?? []).join() === (b ?? []).join();

export function asImageFile(value: unknown): string {
	if (typeof value !== 'string' || !IMAGE_FILE_PATTERN.test(value)) {
		fail('invalid', 'That picture could not be used.');
	}
	return value;
}

export function asMapKind(value: unknown): MapKind {
	if (value !== 'world' && value !== 'battle') fail('invalid', 'Unknown kind of map.');
	return value;
}

/** A grid with whichever of its settings are present changed, and checked. */
export function asGrid(value: unknown, current: Grid): Grid {
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
export function asCellFeet(value: unknown): number {
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
export function asMarks(value: unknown): TokenMark[] {
	if (!Array.isArray(value) || value.some((mark) => !TOKEN_MARK_IDS.includes(mark))) {
		fail('invalid', 'Unknown mark.');
	}
	return TOKEN_MARK_IDS.filter((mark) => value.includes(mark)) as TokenMark[];
}

/** The number a token carries, or null for none. */
export function asCount(value: unknown): number | null {
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
export function asTokenChanges(db: Db, actor: Actor, value: unknown): Partial<TokenInput> {
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
	if (raw.countHidden !== undefined) out.countHidden = asBool(raw.countHidden);
	if (raw.ownerId !== undefined) out.ownerId = raw.ownerId === null ? null : asId(raw.ownerId);
	if (raw.character !== undefined) out.character = asBool(raw.character);
	if (raw.hidden !== undefined) out.hidden = asBool(raw.hidden);
	if (raw.seenBy !== undefined) out.seenBy = asSeenBy(db, actor, raw.seenBy);
	return out;
}

/** Validates whichever marker fields are present and drops everything else. */
export function asMarkerChanges(db: Db, actor: Actor, value: unknown): Partial<MarkerInput> {
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
	if (raw.image !== undefined) out.image = raw.image === null ? null : asImageFile(raw.image);
	return out;
}
