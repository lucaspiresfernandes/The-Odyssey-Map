import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { knocked } from '#lib/server/bridge.ts';
import { findCampaignByInvite, getMembership } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import {
	KNOCK_LASTS,
	SEAT_COOKIE,
	forgetKnock,
	knock,
	seatAnswer,
	seatsOf
} from '#lib/server/seats.ts';
import { cookieOptions } from '#lib/server/session.ts';
import { ActionError } from '#lib/server/world.ts';
import type { Actions, PageServerLoad } from './$types';

function campaignOf(event: RequestEvent) {
	const campaign = findCampaignByInvite(getDb(), event.params.token!);
	if (!campaign) error(404, 'This invite link is not valid.');
	return campaign;
}

export const load: PageServerLoad = (event) => {
	const db = getDb();
	const campaign = campaignOf(event);
	const { user } = event.locals;
	if (user && getMembership(db, campaign.id, user.id)) {
		redirect(303, `/c/${campaign.id}`);
	}
	// The link gets nobody further than this page: a seat is the GM's to
	// make, and to let someone into. This browser may be waiting on their
	// answer already.
	// Only looked at here: the answer is read by the page itself, which is
	// what lets the browser in. A yes that came while the page was closed is
	// still waiting to be read.
	const asked = seatAnswer(db, campaign.id, event.cookies.get(SEAT_COOKIE), true);
	const waiting = asked.status === 'waiting' || asked.status === 'granted';
	return {
		campaignName: campaign.name,
		// Whoever is logged in sits at some other table. Sitting down at this
		// one makes this browser the player they pick.
		user,
		// The seats the GM made, to pick one's own name among. One with
		// someone in it is theirs to ask back, from another browser.
		seats: seatsOf(db, campaign.id),
		waiting: waiting ? { name: asked.name ?? '', taken: asked.taken ?? false } : null
	};
};

export const actions: Actions = {
	/**
	 * Asks for one of the seats the GM made. Nobody sits down by it: the GM
	 * is told, and answers. One asking per browser: an earlier one is dropped.
	 */
	claim: async (event) => {
		const db = getDb();
		const campaign = campaignOf(event);
		const { user } = event.locals;
		if (user && getMembership(db, campaign.id, user.id)) redirect(303, `/c/${campaign.id}`);
		const seat = (await event.request.formData()).get('seat');
		try {
			forgetKnock(db, event.cookies.get(SEAT_COOKIE));
			event.cookies.set(SEAT_COOKIE, knock(db, campaign.id, seat), {
				...cookieOptions(event),
				maxAge: KNOCK_LASTS / 1000
			});
		} catch (err) {
			if (!(err instanceof ActionError)) throw err;
			return fail(400, { message: err.message });
		} finally {
			// Told either way: an earlier asking may be gone even if this one failed.
			await knocked(db, campaign.id);
		}
		return { asked: true };
	},

	/** Stops waiting for the GM. */
	cancel: async (event) => {
		const db = getDb();
		const campaign = campaignOf(event);
		forgetKnock(db, event.cookies.get(SEAT_COOKIE));
		event.cookies.delete(SEAT_COOKIE, cookieOptions(event));
		await knocked(db, campaign.id);
		return { asked: false };
	}
};
