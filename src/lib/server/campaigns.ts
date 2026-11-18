// Campaigns and who belongs to them.

import type { User } from './auth';
import type { Db } from './db';
import { newId, newToken } from './ids';
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

export function createCampaign(db: Db, owner: User, rawName: unknown): Campaign {
	const name = typeof rawName === 'string' ? rawName.trim() : '';
	if (name.length < 1 || name.length > LIMITS.name) {
		throw new Error(`Give the campaign a name of up to ${LIMITS.name} characters.`);
	}
	if (owner.isGuest) throw new Error('Create an account to run your own campaign.');

	return db
		.transaction(() => {
			const id = newId();
			const now = Date.now();
			// The campaign row needs its root map id and the map row needs its
			// campaign id, so the check is deferred to the end of the transaction.
			db.exec('PRAGMA defer_foreign_keys = ON');
			const rootMapId = insertMap(db, id, null, name);
			db.query(
				`INSERT INTO campaigns (id, name, owner_id, invite_token, root_map_id, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			).run(id, name, owner.id, newToken(), rootMapId, now);
			db.query(
				`INSERT INTO members (campaign_id, user_id, role, joined_at) VALUES (?, ?, 'gm', ?)`
			).run(id, owner.id, now);
			return { id, name, rootMapId };
		})
		.immediate();
}

export function listCampaigns(db: Db, userId: string): CampaignSummary[] {
	const rows = db
		.query(
			`SELECT c.id, c.name, c.root_map_id, m.role FROM members m
			 JOIN campaigns c ON c.id = m.campaign_id
			 WHERE m.user_id = ? ORDER BY c.created_at DESC`
		)
		.all(userId) as { id: string; name: string; root_map_id: string; role: Role }[];
	return rows.map((r) => ({ id: r.id, name: r.name, rootMapId: r.root_map_id, role: r.role }));
}

/** The campaign and this user's role in it, or null if they are not a member. */
export function getMembership(db: Db, campaignId: string, userId: string): CampaignSummary | null {
	const row = db
		.query(
			`SELECT c.id, c.name, c.root_map_id, m.role FROM members m
			 JOIN campaigns c ON c.id = m.campaign_id
			 WHERE m.campaign_id = ? AND m.user_id = ?`
		)
		.get(campaignId, userId) as { id: string; name: string; root_map_id: string; role: Role } | null;
	return row ? { id: row.id, name: row.name, rootMapId: row.root_map_id, role: row.role } : null;
}

/** Who a member is when they act on a campaign. */
export function actorFor(user: User, membership: CampaignSummary): Actor {
	return { userId: user.id, name: user.name, campaignId: membership.id, role: membership.role };
}

export function getInviteToken(db: Db, campaignId: string): string {
	const row = db.query('SELECT invite_token FROM campaigns WHERE id = ?').get(campaignId);
	return (row as { invite_token: string }).invite_token;
}

export function findCampaignByInvite(db: Db, token: string): Campaign | null {
	const row = db
		.query('SELECT id, name, root_map_id FROM campaigns WHERE invite_token = ?')
		.get(token) as { id: string; name: string; root_map_id: string } | null;
	return row ? { id: row.id, name: row.name, rootMapId: row.root_map_id } : null;
}

/** Adds the user as a player. Existing members, the GM included, keep their role. */
export function joinCampaign(db: Db, campaignId: string, userId: string) {
	db.query(
		`INSERT INTO members (campaign_id, user_id, role, joined_at) VALUES (?, ?, 'player', ?)
		 ON CONFLICT (campaign_id, user_id) DO NOTHING`
	).run(campaignId, userId, Date.now());
}
