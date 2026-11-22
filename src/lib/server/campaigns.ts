// Campaigns and who belongs to them.

import { and, desc, eq, sql } from 'drizzle-orm';
import type { User } from './auth';
import type { Db } from './db';
import { newId, newToken } from './ids';
import { campaigns, members } from './schema';
import type { Actor } from './world';
import { ActionError, insertMap } from './world';
import { canEditWorld } from '../shared/rules';
import { LIMITS, type Role } from '../shared/types';

export interface Campaign {
	id: string;
	name: string;
	rootMapId: string;
	/** The date it is in the world, as the GM wrote it. Empty for none. */
	date: string;
}

export interface CampaignSummary extends Campaign {
	role: Role;
}

const campaignColumns = {
	id: campaigns.id,
	name: campaigns.name,
	rootMapId: campaigns.rootMapId,
	date: campaigns.date
};

export function createCampaign(db: Db, owner: User, rawName: unknown): Campaign {
	const name = typeof rawName === 'string' ? rawName.trim() : '';
	if (name.length < 1 || name.length > LIMITS.name) {
		throw new Error(`Give the campaign a name of up to ${LIMITS.name} characters.`);
	}
	if (owner.isGuest) throw new Error('Create an account to run your own campaign.');

	return db.transaction(
		(tx) => {
			const id = newId();
			const now = Date.now();
			// The root map is inserted before the campaign it points at, so the
			// foreign key check is deferred to the end of the transaction.
			tx.run(sql`PRAGMA defer_foreign_keys = ON`);
			const rootMapId = insertMap(tx, id, null, name);
			tx.insert(campaigns)
				.values({ id, name, ownerId: owner.id, inviteToken: newToken(), rootMapId, createdAt: now })
				.run();
			tx.insert(members).values({ campaignId: id, userId: owner.id, role: 'gm', joinedAt: now }).run();
			return { id, name, rootMapId, date: '' };
		},
		{ behavior: 'immediate' }
	);
}

export function listCampaigns(db: Db, userId: string): CampaignSummary[] {
	return db
		.select({ ...campaignColumns, role: members.role })
		.from(members)
		.innerJoin(campaigns, eq(campaigns.id, members.campaignId))
		.where(eq(members.userId, userId))
		.orderBy(desc(campaigns.createdAt))
		.all();
}

/** The campaign and this user's role in it, or null if they are not a member. */
export function getMembership(db: Db, campaignId: string, userId: string): CampaignSummary | null {
	const row = db
		.select({ ...campaignColumns, role: members.role })
		.from(members)
		.innerJoin(campaigns, eq(campaigns.id, members.campaignId))
		.where(and(eq(members.campaignId, campaignId), eq(members.userId, userId)))
		.get();
	return row ?? null;
}

/** Who a member is when they act on a campaign. */
export function actorFor(user: User, membership: CampaignSummary): Actor {
	return { userId: user.id, name: user.name, campaignId: membership.id, role: membership.role };
}

/** The date it is in a campaign's world. Empty for none. */
export function dateOf(db: Db, campaignId: string): string {
	return (
		db.select({ date: campaigns.date }).from(campaigns).where(eq(campaigns.id, campaignId)).get()
			?.date ?? ''
	);
}

/**
 * Says what date it is in the world, or with nothing, that there is none:
 * the GM's to do. It is kept as it was written, on one line, since the
 * calendar is the setting's own. Returns the date as it was kept.
 *
 * It is no event and has no undo: the GM writes the old date back.
 */
export function setDate(db: Db, actor: Actor, raw: unknown): string {
	if (!canEditWorld(actor.role)) throw new ActionError('forbidden', 'Only the GM sets the date.');
	if (typeof raw !== 'string') throw new ActionError('invalid', 'Malformed request.');
	const date = raw.replace(/\s+/g, ' ').trim();
	if (date.length > LIMITS.date) {
		throw new ActionError('invalid', `Keep the date to ${LIMITS.date} characters.`);
	}
	db.update(campaigns).set({ date }).where(eq(campaigns.id, actor.campaignId)).run();
	return date;
}

export function getInviteToken(db: Db, campaignId: string): string {
	return db
		.select({ inviteToken: campaigns.inviteToken })
		.from(campaigns)
		.where(eq(campaigns.id, campaignId))
		.get()!.inviteToken;
}

export function findCampaignByInvite(db: Db, token: string): Campaign | null {
	const row = db
		.select(campaignColumns)
		.from(campaigns)
		.where(eq(campaigns.inviteToken, token))
		.get();
	return row ?? null;
}

/** Adds the user as a player. Existing members, the GM included, keep their role. */
export function joinCampaign(db: Db, campaignId: string, userId: string) {
	db.insert(members)
		.values({ campaignId, userId, role: 'player', joinedAt: Date.now() })
		.onConflictDoNothing()
		.run();
}
