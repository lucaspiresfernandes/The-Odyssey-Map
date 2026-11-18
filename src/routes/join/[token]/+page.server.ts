import { error, fail, redirect } from '@sveltejs/kit';
import { AuthError, createGuest } from '#lib/server/auth.ts';
import { findCampaignByInvite, getMembership, joinCampaign } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { startSession } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const campaign = findCampaignByInvite(db, params.token);
	if (!campaign) error(404, 'This invite link is not valid.');
	if (locals.user && getMembership(db, campaign.id, locals.user.id)) {
		redirect(303, `/c/${campaign.id}`);
	}
	return { campaignName: campaign.name, user: locals.user };
};

export const actions: Actions = {
	default: async (event) => {
		const db = getDb();
		const campaign = findCampaignByInvite(db, event.params.token);
		if (!campaign) error(404, 'This invite link is not valid.');

		let user = event.locals.user;
		if (!user) {
			const form = await event.request.formData();
			try {
				user = createGuest(db, form.get('name'));
			} catch (err) {
				if (err instanceof AuthError) return fail(400, { message: err.message });
				throw err;
			}
			startSession(event, user);
		}
		joinCampaign(db, campaign.id, user.id);
		redirect(303, `/c/${campaign.id}`);
	}
};
