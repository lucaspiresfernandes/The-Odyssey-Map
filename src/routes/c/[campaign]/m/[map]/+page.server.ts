import { error, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { getMapSnapshot } from '#lib/server/queries.ts';
import { requireMember } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	// Checked here as well as in the layout: a page load can run without
	// the layout load running again.
	const { user, campaign } = requireMember(event, event.params.campaign);
	const db = getDb();
	// A table display shows what every player would see: see the layout.
	const display = event.url.searchParams.has('display');
	const who = display ? 'player' : { role: campaign.role, userId: user.id };
	const snapshot = getMapSnapshot(db, campaign.id, event.params.map, who);
	if (!snapshot) {
		// A display has nobody in front of it to find the way back: it falls
		// back to the first map, which is always open.
		if (display && event.params.map !== campaign.rootMapId) {
			redirect(307, `/c/${campaign.id}/m/${campaign.rootMapId}?display`);
		}
		error(404, 'Map not found');
	}
	return { snapshot };
};
