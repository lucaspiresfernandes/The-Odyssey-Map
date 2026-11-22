// The GM saying what date it is in the world.
//
// Like a picture held up for the table, it is not a change to a map, so it
// is no event and has no undo. It is kept with the campaign: a browser that
// connects later is told what the date is.

import { type RequestHandler } from '@sveltejs/kit';
import { dated } from '#lib/server/bridge.ts';
import { setDate } from '#lib/server/campaigns.ts';
import { getDb } from '#lib/server/db.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { DateResponse } from '#lib/shared/types.ts';

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as { date?: unknown } | null;
	try {
		const date = setDate(getDb(), actor, body?.date);
		await dated(actor.campaignId, date);
		return Response.json({ ok: true, date } satisfies DateResponse);
	} catch (err) {
		if (!(err instanceof ActionError)) throw err;
		return Response.json({ ok: false, error: err.message } satisfies DateResponse, {
			status: ERROR_STATUS[err.code]
		});
	}
};
