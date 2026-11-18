import { getInviteToken } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { requireMember } from '#lib/server/session.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const { user, campaign } = requireMember(event, event.params.campaign);
	return {
		campaign: { id: campaign.id, name: campaign.name, rootMapId: campaign.rootMapId },
		role: campaign.role,
		me: { id: user.id, name: user.name },
		// Only the GM hands out invites.
		invitePath: campaign.role === 'gm' ? `/join/${getInviteToken(getDb(), campaign.id)}` : null,
		ws: {
			url: process.env.PUBLIC_WS_URL || null,
			port: Number(process.env.WS_PORT || 3001)
		}
	};
};
