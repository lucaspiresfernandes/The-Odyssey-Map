// Encounters: tokens made ahead of time, to put down in one go. The ambush
// for tomorrow's road, the patrol that walks every corridor, the dragon and
// its cultists.
//
// An encounter is the campaign's, not a map's: it goes down on any battle
// map. It is put together in the gallery, out of the token pictures kept
// there, and is kept as what each token starts out as and where it stands
// from the middle of the encounter, in cells, so it keeps its shape on a
// grid of any size. Where each stands is worked out here whenever its tokens
// change: side by side, in rows. Putting one down is a batch of
// `token.create`, which the browser asks for like any other: this module
// only keeps the encounters.
//
// Like the gallery, what is kept is no part of the world's history: making
// an encounter, changing it and throwing it away are not events, and there
// is no undo. Only the GM ever sees them. An encounter may hold a number the
// GM keeps.

import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { sweepGallery } from './gallery';
import { newId } from './ids';
import { encounters, maps, tokens } from './schema';
import {
	ActionError,
	asText,
	asTokenChanges,
	findPicture,
	tokenColumns,
	type Actor
} from './world';
import { arrangeInCells } from '../shared/grid';
import { canEditWorld } from '../shared/rules';
import { LIMITS, TOKEN_COLORS, type Encounter, type EncounterToken } from '../shared/types';

function requireGm(actor: Actor) {
	if (!canEditWorld(actor.role)) {
		throw new ActionError('forbidden', 'Encounters are the GM’s.');
	}
}

/** The encounters a campaign keeps, by name. The GM's to see. */
export function listEncounters(db: Db, actor: Actor): Encounter[] {
	requireGm(actor);
	return db
		.select({ id: encounters.id, name: encounters.name, tokens: encounters.tokens })
		.from(encounters)
		.where(eq(encounters.campaignId, actor.campaignId))
		.orderBy(sql`${encounters.name} COLLATE NOCASE`, encounters.createdAt)
		.all();
}

/** To a thousandth of a cell: fine enough for a token that stands off the grid. */
const fine = (cells: number) => Math.round(cells * 1000) / 1000;

/** Refuses one encounter more than a campaign keeps. */
function requireRoom(db: Db, actor: Actor) {
	const [{ n }] = db
		.select({ n: count() })
		.from(encounters)
		.where(eq(encounters.campaignId, actor.campaignId))
		.all();
	if (n >= LIMITS.encounters) {
		throw new ActionError(
			'conflict',
			`A campaign keeps up to ${LIMITS.encounters} encounters. Throw one away first.`
		);
	}
}

/**
 * The tokens of an encounter as the gallery sends them: each checked the
 * way a token on its way to a map is, and stood in its place among the
 * rest. A token wears a token picture of this campaign's, or none.
 */
function asEncounterTokens(db: Db, actor: Actor, value: unknown): EncounterToken[] {
	if (!Array.isArray(value)) throw new ActionError('invalid', 'Malformed request.');
	if (value.length > LIMITS.encounterTokens) {
		throw new ActionError(
			'invalid',
			`An encounter holds up to ${LIMITS.encounterTokens} tokens.`
		);
	}
	const pieces = value.map((raw) => {
		const input = asTokenChanges(db, actor, raw);
		if (input.name === undefined) throw new ActionError('invalid', "The name can't be empty.");
		const image = input.image ?? null;
		if (image) findPicture(db, actor, image, 'token');
		return {
			name: input.name,
			color: input.color ?? TOKEN_COLORS[0],
			outline: input.outline ?? null,
			image,
			size: input.size ?? 1,
			rotation: input.rotation ?? 0,
			marks: input.marks ?? [],
			count: input.count ?? null,
			countHidden: input.countHidden === true
		};
	});
	const spots = arrangeInCells(pieces.map((piece) => piece.size));
	return pieces.map((piece, i) => ({ ...piece, dx: spots[i][0], dy: spots[i][1] }));
}

/**
 * Makes an encounter, of the tokens given: none yet, for one the GM is
 * about to fill in the gallery.
 */
export function createEncounter(
	db: Db,
	actor: Actor,
	rawName: unknown,
	rawTokens: unknown = []
): Encounter {
	requireGm(actor);
	const name = asText(rawName, 'The name', LIMITS.name, true);
	return db.transaction(
		(tx) => {
			const encounter = { id: newId(), name, tokens: asEncounterTokens(tx, actor, rawTokens) };
			requireRoom(tx, actor);
			tx.insert(encounters)
				.values({ ...encounter, campaignId: actor.campaignId, createdAt: Date.now() })
				.run();
			return encounter;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Renames an encounter, or says what tokens it holds now, in place of the
 * ones it held: whichever are given. The tokens already put down from it
 * stay as they are. Returns the files of pictures nothing shows any more,
 * which are the caller's to remove: a picture taken out of the gallery was
 * kept for as long as the encounter had a token that wore it.
 */
export function changeEncounter(
	db: Db,
	actor: Actor,
	id: string,
	changes: { name?: unknown; tokens?: unknown }
): string[] {
	requireGm(actor);
	const set: { name?: string; tokens?: EncounterToken[] } = {};
	if (changes.name !== undefined) set.name = asText(changes.name, 'The name', LIMITS.name, true);
	if (changes.tokens !== undefined) set.tokens = asEncounterTokens(db, actor, changes.tokens);
	if (set.name === undefined && set.tokens === undefined) {
		throw new ActionError('invalid', 'Malformed request.');
	}
	const changed = db
		.update(encounters)
		.set(set)
		.where(and(eq(encounters.id, id), eq(encounters.campaignId, actor.campaignId)))
		.returning({ id: encounters.id })
		.all();
	if (changed.length === 0) {
		throw new ActionError('not_found', 'That encounter is not kept any more.');
	}
	// A token taken out of it may have been the last to wear a picture.
	return set.tokens ? sweepGallery(db, actor.campaignId) : [];
}

/**
 * Makes an encounter of tokens that stand on one battle map, by their ids.
 * Each is kept as it is now, but for what belongs to that map and that
 * moment: where the encounter stands, who a token is hidden from, whose it
 * is, whether it is locked. They keep the places they have among each
 * other, for as long as the encounter's tokens are not changed in the
 * gallery. The tokens themselves stay where they are.
 */
export function encounterFromMap(
	db: Db,
	actor: Actor,
	rawName: unknown,
	rawIds: unknown
): Encounter {
	requireGm(actor);
	const name = asText(rawName, 'The name', LIMITS.name, true);
	if (
		!Array.isArray(rawIds) ||
		rawIds.length === 0 ||
		rawIds.some((id) => typeof id !== 'string' || id.length > 64)
	) {
		throw new ActionError('invalid', 'Select the tokens to save first.');
	}
	const ids = [...new Set(rawIds as string[])];
	if (ids.length > LIMITS.encounterTokens) {
		throw new ActionError(
			'invalid',
			`An encounter holds up to ${LIMITS.encounterTokens} tokens.`
		);
	}

	return db.transaction(
		(tx) => {
			const rows = tx
				.select({
					token: tokenColumns,
					grid: maps.grid,
					width: maps.width,
					height: maps.height
				})
				.from(tokens)
				.innerJoin(maps, eq(maps.id, tokens.mapId))
				.where(
					and(
						inArray(tokens.id, ids),
						isNull(tokens.deletedAt),
						eq(maps.campaignId, actor.campaignId),
						eq(maps.kind, 'battle')
					)
				)
				.orderBy(tokens.createdAt, sql`${tokens}.rowid`)
				.all();
			if (rows.length !== ids.length) {
				throw new ActionError('not_found', 'Some of those tokens are no longer on the map.');
			}
			if (rows.some((row) => row.token.mapId !== rows[0].token.mapId)) {
				throw new ActionError('invalid', 'An encounter is saved from the tokens of one map.');
			}
			requireRoom(tx, actor);

			// The middle of the encounter: half way between its outermost tokens.
			const xs = rows.map((row) => row.token.x);
			const ys = rows.map((row) => row.token.y);
			const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
			const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
			const { grid, width, height } = rows[0];
			const saved: EncounterToken[] = rows.map(({ token }) => ({
				name: token.name,
				color: token.color,
				outline: token.outline,
				image: token.image,
				size: token.size,
				rotation: token.rotation,
				marks: token.marks,
				count: token.count,
				countHidden: token.countHidden,
				dx: fine(((token.x - cx) * width) / grid.size),
				dy: fine(((token.y - cy) * height) / grid.size)
			}));

			const encounter = { id: newId(), name, tokens: saved };
			tx.insert(encounters)
				.values({ ...encounter, campaignId: actor.campaignId, createdAt: Date.now() })
				.run();
			return encounter;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Throws an encounter away. The tokens put down from it stay on their
 * maps. Returns the files of pictures nothing shows any more, which are the
 * caller's to remove: a picture taken out of the gallery was kept for as
 * long as an encounter had a token that wore it.
 */
export function removeEncounter(db: Db, actor: Actor, id: string): string[] {
	requireGm(actor);
	const gone = db
		.delete(encounters)
		.where(and(eq(encounters.id, id), eq(encounters.campaignId, actor.campaignId)))
		.returning({ id: encounters.id })
		.all();
	if (gone.length === 0) {
		throw new ActionError('not_found', 'That encounter is not kept any more.');
	}
	return sweepGallery(db, actor.campaignId);
}
