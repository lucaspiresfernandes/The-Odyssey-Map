// Campaigns and who belongs to them.

import { and, desc, eq, sql } from 'drizzle-orm';
import type { User } from './auth';
import type { Db } from './db';
import { newId, newToken } from './ids';
import { campaigns, members } from './schema';
import type { Actor } from './world';
import { insertMap } from './world';
import { LIMITS, type Role } from '../shared/types';

export interface Campaign {
	id: string;
	name: string;
	rootMapId: string;
}

export interface CampaignSummary extends Campaign {
	role: Role;
}

const campaignColumns = {
	id: campaigns.id,
	name: campaigns.name,
	rootMapId: campaigns.rootMapId
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
			return { id, name, rootMapId };
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
