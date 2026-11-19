// The GM answering someone who asked for a seat, a new one or the one they
// sat in before: let them in, or not.
//
// It is no change to the world, so it is no event and has no undo.

import { type RequestHandler } from '@sveltejs/kit';
import { knocked } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import { answerKnock } from '#lib/server/seats.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { SeatResponse } from '#lib/shared/types.ts';

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as {
		id?: unknown;
		grant?: unknown;
	} | null;
	try {
		answerKnock(getDb(), actor, body?.id, body?.grant);
		return Response.json({ ok: true } satisfies SeatResponse);
	} catch (err) {
		if (!(err instanceof ActionError)) throw err;
		return Response.json({ ok: false, error: err.message } satisfies SeatResponse, {
			status: ERROR_STATUS[err.code]
		});
	} finally {
		// Whoever is still waiting, as the GM's screens are to show it now.
		await knocked(getDb(), actor.campaignId);
	}
};
