import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { knocked } from '#lib/server/bridge.ts';
import { findCampaignByInvite, getMembership } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import {
	KNOCK_LASTS,
	SEAT_COOKIE,
	forgetKnock,
	knock,
	knockAsNew,
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
	// give. This browser may be waiting on their answer already.
	// Only looked at here: the answer is read by the page itself, which is
	// what lets the browser in. A yes that came while the page was closed is
	// still waiting to be read.
	const asked = seatAnswer(db, campaign.id, event.cookies.get(SEAT_COOKIE), true);
	const waiting = asked.status === 'waiting' || asked.status === 'granted';
	return {
		campaignName: campaign.name,
		user,
		// Someone with no login may have sat at this table before: the seats
		// that are taken are theirs to ask for.
		seats: user ? [] : seatsOf(db, campaign.id),
		waiting: waiting ? { name: asked.name ?? '', newcomer: asked.newcomer ?? false } : null
	};
};

/**
 * Knocks, and hands this browser what it hears the answer by. One asking
 * per browser: an earlier one is dropped.
 */
async function ask(event: RequestEvent, campaignId: string, knocking: () => string) {
	const db = getDb();
	try {
		forgetKnock(db, event.cookies.get(SEAT_COOKIE));
		event.cookies.set(SEAT_COOKIE, knocking(), {
			...cookieOptions(event),
			maxAge: KNOCK_LASTS / 1000
		});
	} catch (err) {
		if (!(err instanceof ActionError)) throw err;
		return fail(400, { message: err.message });
	} finally {
		// Told either way: an earlier asking may be gone even if this one failed.
		await knocked(db, campaignId);
	}
	return { asked: true };
}

export const actions: Actions = {
	/**
	 * Asks for a new seat: as whoever this browser is logged in as, or under
	 * the name given. Nobody joins by it: the GM is told, and answers.
	 */
	join: async (event) => {
		const db = getDb();
		const campaign = campaignOf(event);
		const { user } = event.locals;
		if (user && getMembership(db, campaign.id, user.id)) redirect(303, `/c/${campaign.id}`);
		const name = user ? null : (await event.request.formData()).get('name');
		return ask(event, campaign.id, () =>
			knockAsNew(db, campaign.id, user ? { user } : { name })
		);
	},

	/** Asks for a seat that is taken: the GM is told, and answers. */
	claim: async (event) => {
		const db = getDb();
		const campaign = campaignOf(event);
		if (event.locals.user) return fail(400, { message: 'You are logged in already.' });
		const seat = (await event.request.formData()).get('seat');
		return ask(event, campaign.id, () => knock(db, campaign.id, seat));
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
