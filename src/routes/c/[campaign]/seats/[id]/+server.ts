// One seat at the table: changing what its player is called, and taking it
// away. Both are the GM's.
//
// Neither is a change to the world, so neither is an event and there is no
// undo. Taking a seat away hands its tokens back to nobody, which is one:
// that part reaches the table like any other change.

import { type RequestHandler } from '@sveltejs/kit';
import { announce, holdUp, seated } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import { shownTo } from '#lib/server/gallery.ts';
import { removeSeat, renameSeat, rosterOf } from '#lib/server/seats.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { SeatsResponse } from '#lib/shared/types.ts';

function refusal(err: unknown) {
	if (!(err instanceof ActionError)) throw err;
	return Response.json({ ok: false, error: err.message } satisfies SeatsResponse, {
		status: ERROR_STATUS[err.code]
	});
}

export const PATCH: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as { name?: unknown } | null;
	try {
		const db = getDb();
		const seat = renameSeat(db, actor, event.params.id, body?.name);
		// Whoever is at the table under that name is called the new one from now on.
		await seated(actor.campaignId, [{ id: seat.id, name: seat.name }]);
		return Response.json({ ok: true, seats: rosterOf(db, actor.campaignId) } satisfies SeatsResponse);
	} catch (err) {
		return refusal(err);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	try {
		const db = getDb();
		const id = event.params.id!;
		const events = removeSeat(db, actor, id);
		// The tokens that were theirs are nobody's now, for everyone to hear.
		await announce(db, events);
		// A picture held up for them may have been put away with them.
		const shown = shownTo(db, actor.campaignId);
		await holdUp(actor.campaignId, shown, shown?.to ?? []);
		// And whichever browsers sat in the seat are shown out.
		await seated(actor.campaignId, [{ id, name: null }]);
		return Response.json({ ok: true, seats: rosterOf(db, actor.campaignId) } satisfies SeatsResponse);
	} catch (err) {
		return refusal(err);
	}
};
