// Asked by a browser that is waiting to be let into a seat: how it stands.
// Once the GM has said yes, this is what seats the browser: it is logged in
// as the player whose seat it asked for. That uses the asking up.

import { type RequestHandler } from '@sveltejs/kit';
import { findCampaignByInvite } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { SEAT_COOKIE, seatAnswer } from '#lib/server/seats.ts';
import { cookieOptions, startSession } from '#lib/server/session.ts';
import type { SeatStatus } from '#lib/shared/types.ts';

export const GET: RequestHandler = (event) => {
	const db = getDb();
	const campaign = findCampaignByInvite(db, event.params.token!);
	const answer = (status: SeatStatus) =>
		Response.json(status, { headers: { 'cache-control': 'no-store' } });
	if (!campaign) return answer({ status: 'gone' });

	const asked = seatAnswer(db, campaign.id, event.cookies.get(SEAT_COOKIE));
	if (asked.status === 'waiting') return answer({ status: 'waiting' });
	// Answered, or lapsed: either way there is nothing left to hold on to.
	event.cookies.delete(SEAT_COOKIE, cookieOptions(event));
	if (asked.status !== 'granted' || !asked.user) return answer({ status: asked.status });
	// Only a player with nothing to log in with is logged in by the GM's
	// yes, and only such a seat can be asked for: an account has its
	// password for that.
	if (asked.user.isGuest && event.locals.user?.id !== asked.user.id) {
		startSession(event, asked.user);
	}
	return answer({ status: 'granted', to: `/c/${campaign.id}` });
};
