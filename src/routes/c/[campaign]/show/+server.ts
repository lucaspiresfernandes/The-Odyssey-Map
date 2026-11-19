// The GM holding a picture of the gallery up for the whole table, or
// putting it away again.
//
// It is not a change to the world, so it is no event and has no undo. But
// it is kept, with the campaign: a browser that connects later is told
// what is up, and a player is let load that picture for as long as it is.

import { json, type RequestHandler } from '@sveltejs/kit';
import { holdUp } from '#lib/server/bridge.ts';
import { getDb } from '#lib/server/db.ts';
import { showToTable } from '#lib/server/gallery.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { ShowResponse } from '#lib/shared/types.ts';

export const POST: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as { id?: unknown } | null;
	const id = body?.id;
	if (id !== null && (typeof id !== 'string' || id.length === 0 || id.length > 64)) {
		return json({ ok: false, error: 'Malformed request.' } satisfies ShowResponse, { status: 400 });
	}
	try {
		const shown = showToTable(getDb(), actor, id);
		await holdUp(actor.campaignId, shown);
		return json({ ok: true } satisfies ShowResponse);
	} catch (err) {
		if (!(err instanceof ActionError)) throw err;
		return json({ ok: false, error: err.message } satisfies ShowResponse, {
			status: ERROR_STATUS[err.code]
		});
	}
};
