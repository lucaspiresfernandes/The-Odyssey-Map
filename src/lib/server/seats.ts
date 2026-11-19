// A seat at the table, and getting into it.
//
// The invite link gets someone to the door, and no further: the GM lets
// them in. That goes for a new seat, and for one that is taken.
//
// A player who joined by invite link has no password: who they are is a
// cookie in the browser they joined with. Clear it, or come on another
// device, and they would be a stranger, with none of the secrets they were
// let in on and none of their notes. So the invite link also offers the
// seats that are taken: someone picks their own name, the GM is asked, and
// on a yes that browser is logged in as the player they were.
//
// The asking is called a knock. It is the GM's to answer, because the
// invite link alone must be enough neither to sit down nor to become
// someone else.

import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { AuthError, cleanName, createGuest, hashToken, type User } from './auth';
import { joinCampaign } from './campaigns';
import type { Db } from './db';
import { newId, newToken } from './ids';
import { members, seatClaims, users } from './schema';
import { ActionError, type Actor } from './world';
import { canEditWorld } from '../shared/rules';
import { LIMITS, type Knock, type Player, type SeatStatus } from '../shared/types';

/** How long a knock waits for the GM, and how long its answer waits to be heard: in milliseconds. */
export const KNOCK_LASTS = 10 * 60 * 1000;

/** The cookie a browser that has knocked holds, to hear the answer by. */
export const SEAT_COOKIE = 'odyssey_seat';

/**
 * The seats of a campaign someone could ask for: its players who joined by
 * invite link, in the order they joined. A player with an account of their
 * own logs in with it instead.
 */
export function seatsOf(db: Db, campaignId: string): Player[] {
	return db
		.select({ id: users.id, name: users.name })
		.from(members)
		.innerJoin(users, eq(users.id, members.userId))
		.where(
			and(
				eq(members.campaignId, campaignId),
				eq(members.role, 'player'),
				isNull(users.passwordHash)
			)
		)
		.orderBy(members.joinedAt, sql`${members}.rowid`)
		.all();
}

/** The claim's row and the member it would be, when its user sits at this table already. */
const seated = and(
	eq(members.campaignId, seatClaims.campaignId),
	eq(members.userId, seatClaims.userId)
);

/**
 * Asks for a seat that is taken. Returns what the browser is to hold, to
 * hear the answer by: only a hash of it is kept. Asking again for the same
 * seat takes the place of the earlier asking.
 */
export function knock(db: Db, campaignId: string, userId: unknown): string {
	if (typeof userId !== 'string' || !seatsOf(db, campaignId).some((seat) => seat.id === userId)) {
		throw new ActionError('not_found', 'That seat is not at this table.');
	}
	return ask(db, campaignId, { userId, name: null });
}

/**
 * Asks for a new seat: as whoever is logged in, or under the name someone
 * with no login gives. Nobody is made a player by it: that waits for the
 * GM's yes. Returns what the browser is to hold, as `knock` does.
 */
export function knockAsNew(
	db: Db,
	campaignId: string,
	who: { user: Pick<User, 'id'> } | { name: unknown }
): string {
	if ('user' in who) {
		const member = db
			.select({ userId: members.userId })
			.from(members)
			.where(and(eq(members.campaignId, campaignId), eq(members.userId, who.user.id)))
			.get();
		if (member) throw new ActionError('conflict', 'You have a seat at this table already.');
		return ask(db, campaignId, { userId: who.user.id, name: null });
	}
	try {
		return ask(db, campaignId, { userId: null, name: cleanName(who.name) });
	} catch (err) {
		if (err instanceof AuthError) throw new ActionError('invalid', err.message);
		throw err;
	}
}

function ask(
	db: Db,
	campaignId: string,
	who: { userId: string; name: null } | { userId: null; name: string }
): string {
	return db.transaction(
		(tx) => {
			const now = Date.now();
			// What nobody is waiting on any more is swept out as new ones come in.
			tx.delete(seatClaims).where(lt(seatClaims.createdAt, now - KNOCK_LASTS)).run();
			if (who.userId) {
				tx.delete(seatClaims)
					.where(
						and(
							eq(seatClaims.campaignId, campaignId),
							eq(seatClaims.userId, who.userId),
							eq(seatClaims.status, 'waiting')
						)
					)
					.run();
			}
			if (knocksOf(tx, campaignId).length >= LIMITS.knocks) {
				throw new ActionError(
					'conflict',
					'Too many people are waiting to be let in. Ask the GM to answer them first.'
				);
			}
			const token = newToken();
			tx.insert(seatClaims)
				.values({ id: newId(), campaignId, ...who, tokenHash: hashToken(token), createdAt: now })
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
			userId: seatClaims.userId,
			name: sql<string>`coalesce(${seatClaims.name}, ${users.name})`,
			seat: members.userId,
			at: seatClaims.createdAt
		})
		.from(seatClaims)
		.leftJoin(users, eq(users.id, seatClaims.userId))
		.leftJoin(members, seated)
		.where(
			and(
				eq(seatClaims.campaignId, campaignId),
				eq(seatClaims.status, 'waiting'),
				gt(seatClaims.createdAt, Date.now() - KNOCK_LASTS)
			)
		)
		.orderBy(seatClaims.createdAt, sql`${seatClaims}.rowid`)
		.all()
		.map(({ seat, ...knock }) => ({ ...knock, newcomer: seat === null }));
}

/** The GM lets someone into the seat they asked for, or doesn't. */
export function answerKnock(db: Db, actor: Actor, id: unknown, grant: unknown): void {
	if (!canEditWorld(actor.role)) {
		throw new ActionError('forbidden', 'Only the GM lets someone into a seat.');
	}
	if (typeof id !== 'string' || typeof grant !== 'boolean') {
		throw new ActionError('invalid', 'Malformed request.');
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
	/** The name asked under, or of the seat asked for. */
	name?: string;
	/** A new seat was asked for, not one that is taken. */
	newcomer?: boolean;
	/** Who the browser is seated as, once it is `granted` and read. */
	user?: User;
}

/**
 * How it stands with the seat a browser asked for, by what it holds. Once
 * it is `granted`, `user` is who that browser is seated as. It is the
 * reading that seats them: someone new is made a player here, and not
 * before, so a yes nobody comes back to hear leaves no empty seat. The
 * asking is used up by being read, so it lets one browser in, once. With
 * `peek` it is only looked at, and stays to be read.
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
					userId: seatClaims.userId,
					asName: seatClaims.name,
					userName: users.name,
					passwordHash: users.passwordHash,
					seat: members.userId
				})
				.from(seatClaims)
				.leftJoin(users, eq(users.id, seatClaims.userId))
				.leftJoin(members, seated)
				.where(
					and(eq(seatClaims.tokenHash, hashToken(token)), eq(seatClaims.campaignId, campaignId))
				)
				.get();
			if (!claim || claim.createdAt <= Date.now() - KNOCK_LASTS) return { status: 'gone' };
			const name = claim.asName ?? claim.userName ?? '';
			const newcomer = claim.seat === null;
			if (claim.status === 'waiting' || peek) return { status: claim.status, name, newcomer };

			tx.delete(seatClaims).where(eq(seatClaims.id, claim.id)).run();
			if (claim.status === 'refused') return { status: 'refused', name, newcomer };
			const user: User = claim.userId
				? { id: claim.userId, name, isGuest: claim.passwordHash === null }
				: createGuest(tx, name);
			if (newcomer) joinCampaign(tx, campaignId, user.id);
			return { status: 'granted', name, newcomer, user };
		},
		{ behavior: 'immediate' }
	);
}

/** The browser that asked has changed its mind. */
export function forgetKnock(db: Db, token: string | undefined | null): void {
	if (token) db.delete(seatClaims).where(eq(seatClaims.tokenHash, hashToken(token))).run();
}
