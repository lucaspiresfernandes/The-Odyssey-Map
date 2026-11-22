// One encounter: renaming it, saying what tokens it holds, and throwing it
// away. All of it is the GM's.

import { type RequestHandler } from '@sveltejs/kit';
import { getDb } from '#lib/server/db.ts';
import { changeEncounter, listEncounters, removeEncounter } from '#lib/server/encounters.ts';
import { requireMemberApi } from '#lib/server/session.ts';
import { dropImages } from '#lib/server/tiles.ts';
import { ActionError, ERROR_STATUS } from '#lib/server/world.ts';
import type { EncountersResponse } from '#lib/shared/types.ts';

function refusal(err: unknown) {
	if (!(err instanceof ActionError)) throw err;
	return Response.json({ ok: false, error: err.message } satisfies EncountersResponse, {
		status: ERROR_STATUS[err.code]
	});
}

/** A new `name`, or the `tokens` it holds from now on: whichever are given. */
export const PATCH: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	const body = (await event.request.json().catch(() => null)) as {
		name?: unknown;
		tokens?: unknown;
	} | null;
	try {
		const db = getDb();
		// A picture only a token taken out of it still wore goes with that token.
		await dropImages(changeEncounter(db, actor, event.params.id!, body ?? {}));
		return Response.json({
			ok: true,
			items: listEncounters(db, actor)
		} satisfies EncountersResponse);
	} catch (err) {
		return refusal(err);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { actor } = requireMemberApi(event, event.params.campaign!);
	try {
		const db = getDb();
		// A picture only the encounter still wore goes with it.
		await dropImages(removeEncounter(db, actor, event.params.id!));
		return Response.json({
			ok: true,
			items: listEncounters(db, actor)
		} satisfies EncountersResponse);
	} catch (err) {
		return refusal(err);
	}
};
