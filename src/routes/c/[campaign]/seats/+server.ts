// The seats at a campaign's table, which are the GM's to look after: the
// list of them, making one ahead of the session, and answering someone who
// asked for a seat on the invite link, a new one or the one they sat in
// before.
//
// None of it is a change to the world, so none of it is an event and there
// is no undo.

import { type RequestHandler } from '@sveltejs/kit';
import { knocked, onlineAt } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import { answerKnock, createSeat, rosterOf } from '#lib/server/seats.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { SeatResponse, SeatsResponse } from '#lib/shared/types.ts';

function refusal(err: unknown) {
	if (!(err instanceof ActionError)) throw err;
	return Response.json({ ok: false, error: err.message } satisfies SeatsResponse, {
		status: ERROR_STATUS[err.code]
	});
}

/** Every seat at the table, for the GM. */
export const GET: RequestHandler = (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	if (actor.role !== 'gm') {
		return refusal(new ActionError('forbidden', 'Only the GM looks after the seats.'));
	}
	return Response.json(
		{ ok: true, seats: rosterOf(getDb(), actor.campaignId) } satisfies SeatsResponse,
		{ headers: { 'cache-control': 'no-store' } }
	);
};

/**
 * With a `name`, makes a seat by that name, with nobody in it yet. With the
 * `id` of someone asking for a seat, answers them: `grant` lets them in.
 */
export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as {
		id?: unknown;
		grant?: unknown;
		name?: unknown;
	} | null;

	if (body?.name !== undefined) {
		try {
			const db = getDb();
			createSeat(db, actor, body.name);
			return Response.json({ ok: true, seats: rosterOf(db, actor.campaignId) } satisfies SeatsResponse);
		} catch (err) {
			return refusal(err);
		}
	}

	// Nobody is let into a seat whose player is at the table.
	const online = body?.grant === true ? await onlineAt(actor.campaignId) : [];
	try {
		answerKnock(getDb(), actor, body?.id, body?.grant, online);
		return Response.json({ ok: true } satisfies SeatResponse);
	} catch (err) {
		return refusal(err);
	} finally {
		// Whoever is still waiting, as the GM's screens are to show it now.
		await knocked(getDb(), actor.campaignId);
	}
};
