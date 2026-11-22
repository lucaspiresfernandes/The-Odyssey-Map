// The party: what goes down for each player on a new battle map.
//
// Nothing is kept for it. A player's character is one of the tokens that
// are theirs, as it looks now: its name, its picture, its colour, its ring
// and its size. Which one is said on the token: see `Token.characterAt`.
// The one said so last is it, on whatever map it stands, or stood before it
// was taken off. Until that is said of any, it is the first token they were
// given on the map where they last got one: the ranger, and not the wolf
// that was copied from her afterwards.
//
// Putting the party down is a batch of `token.create` that the browser asks
// for, each token handed to its player and said to be their character: so
// what a player changes about their token on one map is what goes down for
// them on the next.

import { and, eq } from 'drizzle-orm';
import type { Db } from './db';
import { playersOf } from './queries';
import { maps, tokens } from './schema';
import type { Actor } from './world';
import type { PartyMember, Player } from '../shared/types';

/** The character of one player, or null while no token is theirs. */
function characterOf(db: Db, campaignId: string, player: Player): PartyMember | null {
	const theirs = db
		.select({
			mapId: tokens.mapId,
			name: tokens.name,
			color: tokens.color,
			outline: tokens.outline,
			image: tokens.image,
			size: tokens.size,
			characterAt: tokens.characterAt,
			createdAt: tokens.createdAt,
			deletedAt: tokens.deletedAt
		})
		.from(tokens)
		.innerJoin(maps, eq(maps.id, tokens.mapId))
		.where(and(eq(maps.campaignId, campaignId), eq(tokens.ownerId, player.id)))
		.orderBy(tokens.createdAt)
		.all();

	// The one said to be their character last, on the map or taken off it.
	let token = theirs
		.filter((each) => each.characterAt !== null)
		.sort((a, b) => b.characterAt! - a.characterAt!)[0];
	if (!token) {
		// Said of none: the first they were given, on the map where they were last given one.
		const standing = theirs.filter((each) => each.deletedAt === null);
		const latest = standing[standing.length - 1];
		token = standing.find((each) => each.mapId === latest?.mapId)!;
	}
	if (!token) return null;
	const { name, color, outline, image, size } = token;
	return { userId: player.id, player: player.name, name, color, outline, image, size };
}

/**
 * The party as someone is told of it. The GM is told the character of every
 * player who has one, in the order they joined. A player is told their own.
 */
export function partyOf(db: Db, actor: Actor): PartyMember[] {
	const players = playersOf(db, actor.campaignId).filter(
		(player) => actor.role === 'gm' || player.id === actor.userId
	);
	return players.flatMap((player) => characterOf(db, actor.campaignId, player) ?? []);
}
