import { error } from '@sveltejs/kit';
import { listMembers } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { getMapSnapshot } from '#lib/server/queries.ts';
import { requireMember } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	// Checked here as well as in the layout: a page load can run without
	// the layout load running again.
	const { campaign } = requireMember(event, event.params.campaign);
	const db = getDb();
	const snapshot = getMapSnapshot(db, campaign.id, event.params.map, campaign.role);
	if (!snapshot) error(404, 'Map not found');
	return {
		snapshot,
		// Who the GM can hand a token to. Read with the map, so someone who
		// joined since the last one is on the list.
		members: campaign.role === 'gm' ? listMembers(db, campaign.id) : []
	};
};
