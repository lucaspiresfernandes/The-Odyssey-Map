// Saved groups: tokens the GM saved together, to put down again in one go.
// The ambush for tomorrow's road, the patrol that walks every corridor, the
// party itself.
//
// A group is the campaign's, not a map's: it goes down on any battle map.
// It is kept as what each token starts out as, and where it stands from the
// middle of the group in cells, so it keeps its shape on a grid of another
// size. Putting one down is a batch of `token.create`, which the browser
// asks for like any other: this module only keeps the groups.
//
// Like the gallery, what is saved is no part of the world's history: saving
// a group and throwing one away are not events, and there is no undo. Only
// the GM ever sees them. A saved group may hold a number the GM keeps.

import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { sweepGallery } from './gallery';
import { newId } from './ids';
import { maps, tokenGroups, tokens } from './schema';
import { ActionError, asText, tokenColumns, type Actor } from './world';
import { canEditWorld } from '../shared/rules';
import { LIMITS, type GroupToken, type TokenGroup } from '../shared/types';

function requireGm(actor: Actor) {
	if (!canEditWorld(actor.role)) {
		throw new ActionError('forbidden', 'Saved groups are the GM’s.');
	}
}

/** The groups a campaign has saved, by name. The GM's to see. */
export function listGroups(db: Db, actor: Actor): TokenGroup[] {
	requireGm(actor);
	return db
		.select({ id: tokenGroups.id, name: tokenGroups.name, tokens: tokenGroups.tokens })
		.from(tokenGroups)
		.where(eq(tokenGroups.campaignId, actor.campaignId))
		.orderBy(sql`${tokenGroups.name} COLLATE NOCASE`, tokenGroups.createdAt)
		.all();
}

/** To a thousandth of a cell: fine enough for a token that stands off the grid. */
const fine = (cells: number) => Math.round(cells * 1000) / 1000;

/**
 * Saves tokens that stand on one battle map as a group, by their ids. Each
 * is kept as it is now, but for what belongs to that map and that moment:
 * where the group stands, who a token is hidden from, whose it is, whether
 * it is locked. The tokens themselves stay where they are.
 */
export function saveGroup(db: Db, actor: Actor, rawName: unknown, rawIds: unknown): TokenGroup {
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
	if (ids.length > LIMITS.groupTokens) {
		throw new ActionError('invalid', `A group holds up to ${LIMITS.groupTokens} tokens.`);
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
				throw new ActionError('invalid', 'A group is saved from the tokens of one map.');
			}
			const [{ n }] = tx
				.select({ n: count() })
				.from(tokenGroups)
				.where(eq(tokenGroups.campaignId, actor.campaignId))
				.all();
			if (n >= LIMITS.groups) {
				throw new ActionError(
					'conflict',
					`A campaign keeps up to ${LIMITS.groups} saved groups. Throw one away first.`
				);
			}

			// The middle of the group: half way between its outermost tokens.
			const xs = rows.map((row) => row.token.x);
			const ys = rows.map((row) => row.token.y);
			const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
			const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
			const { grid, width, height } = rows[0];
			const saved: GroupToken[] = rows.map(({ token }) => ({
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

			const group = { id: newId(), name, tokens: saved };
			tx.insert(tokenGroups)
				.values({ ...group, campaignId: actor.campaignId, createdAt: Date.now() })
				.run();
			return group;
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Throws a saved group away. The tokens put down from it stay on their
 * maps. Returns the files of pictures nothing shows any more, which are the
 * caller's to remove: a picture taken out of the gallery was kept for as
 * long as a group had a token that wore it.
 */
export function removeGroup(db: Db, actor: Actor, id: string): string[] {
	requireGm(actor);
	const gone = db
		.delete(tokenGroups)
		.where(and(eq(tokenGroups.id, id), eq(tokenGroups.campaignId, actor.campaignId)))
		.returning({ id: tokenGroups.id })
		.all();
	if (gone.length === 0) throw new ActionError('not_found', 'That group is not saved any more.');
	return sweepGallery(db, actor.campaignId);
}
