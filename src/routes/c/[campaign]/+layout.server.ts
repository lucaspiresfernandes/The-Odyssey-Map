import { getInviteToken } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { lanHosts, publicOrigins } from '#lib/server/network.ts';
import { playersOf } from '#lib/server/queries.ts';
import { requireMember } from '#lib/server/session.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const { user, campaign } = requireMember(event, event.params.campaign);
	// A table display, asked for with `?display` on any map: the players'
	// view on a screen of its own, whoever opened it. The GM's own login
	// then loads nothing a player would not be sent.
	const display = event.url.searchParams.has('display');
	const role = display ? 'player' : campaign.role;
	return {
		campaign: { id: campaign.id, name: campaign.name, rootMapId: campaign.rootMapId },
		role,
		display,
		me: { id: user.id, name: user.name },
		// Only the GM hands out invites: from their own screen, or on a table
		// display they opened and asked to show it, with `invite` in its
		// address, for the players to scan. A display is handed nothing a
		// player would not be until then.
		invite:
			campaign.role === 'gm' && (!display || event.url.searchParams.has('invite'))
				? {
						path: `/join/${getInviteToken(getDb(), campaign.id)}`,
						origins: publicOrigins(),
						hosts: lanHosts()
					}
				: null,
		// And only the GM chooses who is let in on a secret.
		players: role === 'gm' ? playersOf(getDb(), campaign.id) : [],
		ws: {
			url: process.env.PUBLIC_WS_URL || null,
			port: Number(process.env.WS_PORT || 3001)
		}
	};
};
