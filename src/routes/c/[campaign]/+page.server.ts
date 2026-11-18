import { redirect } from '@sveltejs/kit';
import { requireMember } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const { campaign } = requireMember(event, event.params.campaign);
	redirect(303, `/c/${campaign.id}/m/${campaign.rootMapId}`);
};
