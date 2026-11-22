// A seat at the table, and getting into it.
//
// The seats are the GM's to make: one for each player, by name. The invite
// link gets someone to the door, where they pick their name among the
// seats, and no further: the GM lets them in. Nobody makes a seat for
// themselves.
//
// A player has no password: who they are is a cookie in the browser they
// sat down with. Clear it, or come on another device, and they would be a
// stranger, with none of the secrets they were let in on and none of their
// notes. So a seat with someone in it can be asked for as well: the GM is
// asked, and on a yes that browser is logged in as the player they were.
//
// A seat holds one browser. While its player is at the table, nobody else
// can ask for it or be let into it. And a browser let into a seat takes it
// over: whichever sat there before is logged out. Who is at the table is
// known to the WebSocket server alone, so whoever calls in here asks it
// first and hands the answer over as `online`.
//
// The asking is called a knock. It is the GM's to answer, because the
// invite link alone must be enough neither to sit down nor to become
// someone else.

import { and, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { AuthError, cleanName, createGuest, hashToken, type User } from './auth';
import { joinCampaign } from './campaigns';
import type { Db } from './db';
import { newId, newToken } from './ids';
import {
	campaigns,
	drawings,
	maps,
	markers,
	members,
	regions,
	seatClaims,
	sessions,
	tokens,
	users
} from './schema';
import { ActionError, perform, type Actor } from './world';
import { canEditWorld } from '../shared/rules';
import {
	LIMITS,
	type Command,
	type Knock,
	type Seat,
	type SeatStatus,
	type StoredEvent
} from '../shared/types';

/** How long a knock waits for the GM, and how long its answer waits to be heard: in milliseconds. */
export const KNOCK_LASTS = 10 * 60 * 1000;

/** The cookie a browser that has knocked holds, to hear the answer by. */
export const SEAT_COOKIE = 'odyssey_seat';

/** A seat as the invite link offers it: a name, and whether someone sits there already. */
export type OfferedSeat = Pick<Seat, 'id' | 'name' | 'taken'> & {
	/** Its player is at the table this minute: the seat is nobody else's to ask for. */
	here: boolean;
};

/**
 * The seats of a campaign someone could ask for on the invite link: its
 * players with no login of their own, in the order they were made. A
 * player with an account logs in with it instead. `online` is who is at
 * the table this minute, by user id.
 */
export function seatsOf(db: Db, campaignId: string, online: string[] = []): OfferedSeat[] {
	return rosterOf(db, campaignId)
		.filter((seat) => seat.guest)
		.map(({ id, name, taken }) => ({ id, name, taken, here: online.includes(id) }));
}

/**
 * How many seats have nobody in them yet. With none, there is nobody to
 * invite: the GM makes a seat first.
 */
export function freeSeats(db: Db, campaignId: string): number {
	return seatsOf(db, campaignId).filter((seat) => !seat.taken).length;
}

/** Some browser is logged in as this user. */
const satIn = (userId: SQLiteColumn) =>
	sql<boolean>`EXISTS (
		SELECT 1 FROM ${sessions}
		WHERE ${sessions.userId} = ${userId} AND ${sessions.expiresAt} > ${Date.now()}
	)`.mapWith(Boolean);

/** The claim's row and the member it would be, when its user sits at this table already. */
const seated = and(
	eq(members.campaignId, seatClaims.campaignId),
	eq(members.userId, seatClaims.userId)
);

/**
 * Asks for a seat: one the GM made that nobody has sat in yet, or one with
 * someone in it, to get back into from another browser. Returns what the
 * browser is to hold, to hear the answer by: only a hash of it is kept.
 * Asking again for the same seat takes the place of the earlier asking.
 * A seat whose player is at the table, among `online`, is not asked for.
 */
export function knock(db: Db, campaignId: string, userId: unknown, online: string[] = []): string {
	return db.transaction(
		(tx) => {
			const seat =
				typeof userId === 'string'
					? seatsOf(tx, campaignId, online).find((each) => each.id === userId)
					: undefined;
			if (!seat || typeof userId !== 'string') {
				throw new ActionError('not_found', 'That seat is not at this table.');
			}
			if (seat.here) {
				throw new ActionError(
					'conflict',
					`${seat.name} is at the table right now. Nobody else can sit in their seat.`
				);
			}
			const now = Date.now();
			// What nobody is waiting on any more is swept out as new ones come in.
			tx.delete(seatClaims).where(lt(seatClaims.createdAt, now - KNOCK_LASTS)).run();
			tx.delete(seatClaims)
				.where(
					and(
						eq(seatClaims.campaignId, campaignId),
						eq(seatClaims.userId, userId),
						eq(seatClaims.status, 'waiting')
					)
				)
				.run();
			if (knocksOf(tx, campaignId).length >= LIMITS.knocks) {
				throw new ActionError(
					'conflict',
					'Too many people are waiting to be let in. Ask the GM to answer them first.'
				);
			}
			const token = newToken();
			tx.insert(seatClaims)
				.values({ id: newId(), campaignId, userId, tokenHash: hashToken(token), createdAt: now })
				.run();
			return token;
		},
		{ behavior: 'immediate' }
	);
}

/** Everyone waiting to be let into a seat of this campaign, the first to ask first. */
export function knocksOf(db: Db, campaignId: string): Knock[] {
	return db
		.select({
			id: seatClaims.id,
			userId: users.id,
			name: users.name,
			taken: satIn(users.id),
			at: seatClaims.createdAt
		})
		.from(seatClaims)
		.innerJoin(users, eq(users.id, seatClaims.userId))
		.innerJoin(members, seated)
		.where(
			and(
				eq(seatClaims.campaignId, campaignId),
				eq(seatClaims.status, 'waiting'),
				gt(seatClaims.createdAt, Date.now() - KNOCK_LASTS)
			)
		)
		.orderBy(seatClaims.createdAt, sql`${seatClaims}.rowid`)
		.all();
}

/**
 * The GM lets someone into the seat they asked for, or doesn't. Nobody is
 * let into a seat whose player has come to the table since it was asked
 * for, among `online`: the asking stays, for the GM to turn away.
 */
export function answerKnock(
	db: Db,
	actor: Actor,
	id: unknown,
	grant: unknown,
	online: string[] = []
): void {
	if (!canEditWorld(actor.role)) {
		throw new ActionError('forbidden', 'Only the GM lets someone into a seat.');
	}
	if (typeof id !== 'string' || typeof grant !== 'boolean') {
		throw new ActionError('invalid', 'Malformed request.');
	}
	if (grant) {
		const asked = knocksOf(db, actor.campaignId).find((each) => each.id === id);
		if (asked && online.includes(asked.userId)) {
			throw new ActionError(
				'conflict',
				`${asked.name} is at the table right now. Nobody else can sit in their seat.`
			);
		}
	}
	const answered = db
		.update(seatClaims)
		.set({ status: grant ? 'granted' : 'refused' })
		.where(
			and(
				eq(seatClaims.id, id),
				eq(seatClaims.campaignId, actor.campaignId),
				eq(seatClaims.status, 'waiting'),
				gt(seatClaims.createdAt, Date.now() - KNOCK_LASTS)
			)
		)
		.returning({ id: seatClaims.id })
		.all();
	if (answered.length === 0) {
		throw new ActionError('not_found', 'Whoever was asking has given up, or been answered already.');
	}
}

/** How it stands with a seat a browser asked for: see `seatAnswer`. */
export interface SeatAnswer {
	status: SeatStatus['status'];
	/** The name of the seat asked for. */
	name?: string;
	/** Someone sits in that seat already: it is asked back, from another browser. */
	taken?: boolean;
	/** Who the browser is seated as, once it is `granted` and read. */
	user?: User;
}

/**
 * How it stands with the seat a browser asked for, by what it holds. Once
 * it is `granted`, `user` is who that browser is seated as: the player
 * whose seat it is. The asking is used up by being read, so it lets one
 * browser in, once. With `peek` it is only looked at, and stays to be
 * read. A seat the GM took away meanwhile is `gone`.
 *
 * A seat holds one browser: the reading that seats this one logs out
 * whichever sat there before. Whoever calls this logs the new one in.
 */
export function seatAnswer(
	db: Db,
	campaignId: string,
	token: string | undefined | null,
	peek = false
): SeatAnswer {
	if (!token) return { status: 'gone' };
	return db.transaction(
		(tx): SeatAnswer => {
			const claim = tx
				.select({
					id: seatClaims.id,
					status: seatClaims.status,
					createdAt: seatClaims.createdAt,
					userId: users.id,
					name: users.name,
					passwordHash: users.passwordHash,
					taken: satIn(users.id)
				})
				.from(seatClaims)
				.innerJoin(users, eq(users.id, seatClaims.userId))
				.innerJoin(members, seated)
				.where(
					and(eq(seatClaims.tokenHash, hashToken(token)), eq(seatClaims.campaignId, campaignId))
				)
				.get();
			if (!claim || claim.createdAt <= Date.now() - KNOCK_LASTS) return { status: 'gone' };
			const { name, taken } = claim;
			if (claim.status === 'waiting' || peek) return { status: claim.status, name, taken };

			tx.delete(seatClaims).where(eq(seatClaims.id, claim.id)).run();
			if (claim.status === 'refused') return { status: 'refused', name, taken };
			const user: User = { id: claim.userId, name, isGuest: claim.passwordHash === null };
			// Only a seat with no account behind it can be asked for, so these
			// are logins the GM gave, and no password's.
			if (user.isGuest) tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
			return { status: 'granted', name, taken, user };
		},
		{ behavior: 'immediate' }
	);
}

/** The browser that asked has changed its mind. */
export function forgetKnock(db: Db, token: string | undefined | null): void {
	if (token) db.delete(seatClaims).where(eq(seatClaims.tokenHash, hashToken(token))).run();
}

// ------------------------------------------------------ looking after seats

// The seats are the GM's to look after: to make one ahead of the session,
// for someone to sit down in when they come, to change what a player is
// called, and to take one away. A seat is a player of the campaign: a name
// and nothing else, with no login and no password. None of this is a
// change to the world, so none of it is an event and there is no undo.

function requireKeeper(actor: Actor) {
	if (!canEditWorld(actor.role)) {
		throw new ActionError('forbidden', 'Only the GM looks after the seats.');
	}
}

/** Every seat at a campaign's table: its players, in the order they joined. */
export function rosterOf(db: Db, campaignId: string): Seat[] {
	return db
		.select({
			id: users.id,
			name: users.name,
			guest: sql<boolean>`${users.passwordHash} IS NULL`.mapWith(Boolean),
			taken: satIn(users.id)
		})
		.from(members)
		.innerJoin(users, eq(users.id, members.userId))
		.where(and(eq(members.campaignId, campaignId), eq(members.role, 'player')))
		.orderBy(members.joinedAt, sql`${members}.rowid`)
		.all();
}

/** A name for a seat, tidied: one that no other seat at the table has. */
function seatName(db: Db, campaignId: string, raw: unknown, but?: string): string {
	let name: string;
	try {
		name = cleanName(raw);
	} catch (err) {
		if (err instanceof AuthError) throw new ActionError('invalid', err.message);
		throw err;
	}
	// Two seats by one name could not be told apart by whoever comes back for theirs.
	const same = rosterOf(db, campaignId).some(
		(seat) => seat.id !== but && seat.name.toLowerCase() === name.toLowerCase()
	);
	if (same) throw new ActionError('conflict', `There is a seat for “${name}” already.`);
	return name;
}

/** A player of this campaign, by user id, who is not its GM. */
function findSeat(db: Db, actor: Actor, id: unknown): Seat {
	const seat =
		typeof id === 'string' ? rosterOf(db, actor.campaignId).find((each) => each.id === id) : null;
	if (!seat) throw new ActionError('not_found', 'That seat is not at this table.');
	return seat;
}

/**
 * Makes a seat with nobody in it yet: a player by that name, for someone
 * to sit down in when they come. They pick it on the invite link, and the
 * GM lets them in.
 */
export function createSeat(db: Db, actor: Actor, rawName: unknown): Seat {
	requireKeeper(actor);
	return db.transaction(
		(tx) => {
			if (rosterOf(tx, actor.campaignId).length >= LIMITS.seats) {
				throw new ActionError('conflict', `A table has at most ${LIMITS.seats} seats.`);
			}
			const guest = createGuest(tx, seatName(tx, actor.campaignId, rawName));
			joinCampaign(tx, actor.campaignId, guest.id);
			return { id: guest.id, name: guest.name, guest: true, taken: false };
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Changes what the player in a seat is called. Their name is written on
 * what they made, so that is brought along: the tokens that are theirs,
 * their notes and their drawings. A player with an account of their own is
 * called what they chose, and is not the GM's to rename.
 */
export function renameSeat(db: Db, actor: Actor, id: unknown, rawName: unknown): Seat {
	requireKeeper(actor);
	return db.transaction(
		(tx) => {
			const seat = findSeat(tx, actor, id);
			if (!seat.guest) {
				throw new ActionError(
					'conflict',
					`${seat.name} has an account of their own, and is called what they chose.`
				);
			}
			const name = seatName(tx, actor.campaignId, rawName, seat.id);
			if (name === seat.name) return seat;
			tx.update(users).set({ name }).where(eq(users.id, seat.id)).run();
			tx.update(tokens).set({ ownerName: name }).where(eq(tokens.ownerId, seat.id)).run();
			tx.update(markers).set({ authorName: name }).where(eq(markers.authorId, seat.id)).run();
			tx.update(drawings).set({ authorName: name }).where(eq(drawings.authorId, seat.id)).run();
			return { ...seat, name };
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Takes a seat away: whoever sat in it is no longer a player of the
 * campaign. What they made stays on the maps, under their name. The tokens
 * that were theirs are nobody's from now on, which is a change to the
 * world like any other: its events are returned, for whoever called this
 * to hand to the table. They are no longer in on any secret.
 *
 * A seat with no account behind it is gone for good, and with it the login
 * of every browser that sat in it. A player with an account of their own
 * keeps the account, and can ask to join again.
 */
export function removeSeat(db: Db, actor: Actor, id: unknown): StoredEvent[] {
	requireKeeper(actor);
	const seat = findSeat(db, actor, id);
	const inCampaign = db
		.select({ id: maps.id })
		.from(maps)
		.where(eq(maps.campaignId, actor.campaignId));

	// Their tokens are handed back first, as the GM would by hand, so that
	// everyone at the table hears of it: where the fog follows the tokens,
	// what the players see hangs on whose a token is.
	const theirs = db
		.select({ id: tokens.id })
		.from(tokens)
		.where(
			and(eq(tokens.ownerId, seat.id), isNull(tokens.deletedAt), inArray(tokens.mapId, inCampaign))
		)
		.all();
	const events: StoredEvent[] = [];
	for (let i = 0; i < theirs.length; i += LIMITS.batch) {
		const cmds = theirs
			.slice(i, i + LIMITS.batch)
			.map(({ id }): Command => ({ t: 'token.update', id, changes: { ownerId: null } }));
		events.push(...perform(db, actor, { t: 'batch', cmds }));
	}

	db.transaction(
		(tx) => {
			// The ones that were taken off the map are nobody's as well, for when one comes back.
			tx.update(tokens)
				.set({ ownerId: null, ownerName: null })
				.where(and(eq(tokens.ownerId, seat.id), inArray(tokens.mapId, inCampaign)))
				.run();

			// Whatever was a secret with them is a secret with one fewer.
			const named = `%"${seat.id}"%`;
			const without = (seenBy: string[]) => seenBy.filter((each) => each !== seat.id);
			for (const row of tx
				.select({ id: markers.id, seenBy: markers.seenBy })
				.from(markers)
				.where(and(inArray(markers.mapId, inCampaign), sql`${markers.seenBy} LIKE ${named}`))
				.all()) {
				tx.update(markers).set({ seenBy: without(row.seenBy) }).where(eq(markers.id, row.id)).run();
			}
			for (const row of tx
				.select({ id: tokens.id, seenBy: tokens.seenBy })
				.from(tokens)
				.where(and(inArray(tokens.mapId, inCampaign), sql`${tokens.seenBy} LIKE ${named}`))
				.all()) {
				tx.update(tokens).set({ seenBy: without(row.seenBy) }).where(eq(tokens.id, row.id)).run();
			}
			for (const row of tx
				.select({ id: drawings.id, seenBy: drawings.seenBy })
				.from(drawings)
				.where(and(inArray(drawings.mapId, inCampaign), sql`${drawings.seenBy} LIKE ${named}`))
				.all()) {
				tx.update(drawings).set({ seenBy: without(row.seenBy) }).where(eq(drawings.id, row.id)).run();
			}
			for (const row of tx
				.select({ id: regions.id, seenBy: regions.seenBy })
				.from(regions)
				.where(and(inArray(regions.mapId, inCampaign), sql`${regions.seenBy} LIKE ${named}`))
				.all()) {
				tx.update(regions).set({ seenBy: without(row.seenBy) }).where(eq(regions.id, row.id)).run();
			}
			// And a picture held up for them is held up for one fewer. One held
			// up for them alone is put away: with nobody named it would go up
			// for the whole table.
			const held = tx
				.select({ file: campaigns.shownFile, to: campaigns.shownTo })
				.from(campaigns)
				.where(eq(campaigns.id, actor.campaignId))
				.get();
			if (held?.to.includes(seat.id)) {
				const to = without(held.to);
				tx.update(campaigns)
					.set(to.length ? { shownTo: to } : { shownFile: null, shownTo: [] })
					.where(eq(campaigns.id, actor.campaignId))
					.run();
			}

			tx.delete(seatClaims)
				.where(and(eq(seatClaims.campaignId, actor.campaignId), eq(seatClaims.userId, seat.id)))
				.run();
			tx.delete(members)
				.where(and(eq(members.campaignId, actor.campaignId), eq(members.userId, seat.id)))
				.run();

			// A seat with no account behind it was only ever this: with no table
			// left to sit at, there is nobody to keep.
			const elsewhere = tx
				.select({ campaignId: members.campaignId })
				.from(members)
				.where(and(eq(members.userId, seat.id), ne(members.campaignId, actor.campaignId)))
				.get();
			if (seat.guest && !elsewhere) {
				tx.delete(sessions).where(eq(sessions.userId, seat.id)).run();
				tx.delete(users).where(eq(users.id, seat.id)).run();
			}
		},
		{ behavior: 'immediate' }
	);
	return events;
}
